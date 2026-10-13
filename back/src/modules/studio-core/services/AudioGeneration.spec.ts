/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { STUDIO_MAX_EVENT_BYTES } from 'src/modules/media-library';
import { jobVoices, libraryVoiceIds } from './jobVoices';

const DEFAULT_MAX_EVENT_BYTES = 16 * 1024; // `MAX_EVENT_BYTES` of the shared event stream

/** What the audio worker reports for one take: 240 peaks rounded to 3 decimals, one marker per speaker turn. */
function take(run: number, index: number, prompt: string, turns: number) {
  return {
    index, media: 'audio', asset_id: `take-${run}-${index}`, path: `/data/outputs/a${run}_${index}.wav`, filename: `a${run}_${index}.wav`, thumb: null,
    width: null, height: null, seed: 1000 + index, duration: 12.34,
    meta: {
      model_id: 'qwen3-tts-clone', prompt, seconds: 8.2, language: 'fr', instruct: 'voix posée, chaleureuse', voice: 'Alice',
      speakers: ['Alice', 'Marc'], sample_rate: 24000,
      peaks: Array.from({ length: 240 }, (_, i) => Math.round(Math.abs(Math.sin(i / 7)) * 1000) / 1000),
      markers: Array.from({ length: turns }, (_, i) => ({ segment: i, start: i * 3.25, label: i % 2 ? 'Marc' : 'Alice' })),
    },
  };
}

const line = (i: number) => `${i % 2 ? 'Marc' : 'Alice'} : Voilà une réplique assez longue pour un dialogue, avec des accents éàù (${i}).`;

describe('audio generations', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    const c = await s.conversations.create({ title: 'c', mode: 'audio' });
    await dataSource.query("UPDATE conversations SET id = 'c1' WHERE id = ?", [c.id]);
    await s.queue.onApplicationBootstrap();
  });
  afterEach(async () => {
    s.queue.onModuleDestroy();
    await dataSource.destroy();
  });

  let runs = 0;
  async function runTakes(prompt: string, turns: number, count = 4): Promise<number> {
    runs += 1;
    const run = runs;
    await s.messages.create({ id: `u${run}`, conversationId: 'c1', role: 'user', prompt });
    await s.messages.create({ id: `a${run}`, conversationId: 'c1', parentId: `u${run}`, role: 'assistant', prompt, modelId: 'tts', params: { seeds: [1] }, status: 'queued' });
    s.queue.enqueue({ id: `a${run}`, conversationId: 'c1' }, 'audio');
    await s.queue.idle();
    for (let i = 0; i < count; i += 1) {
      s.emit('job.output', { job_id: `a${run}`, ...take(run, i, prompt, turns) });
      await s.queue.idle();
    }
    s.emit('job.done', { job_id: `a${run}`, outputs: count });
    await s.queue.idle();
    const done = s.published.filter((e) => e.type === 'message.updated').at(-1);
    return Buffer.byteLength(JSON.stringify({ topic: done?.topic, type: done?.type, data: done?.data }));
  }

  it('measures the final message.updated of an audio message: a dialogue of four takes exceeds the default 16 KB event limit, the worst case stays under the studio limit', async () => {
    const short = await runTakes('Bonjour tout le monde.', 1);
    expect(short).toBeLessThan(DEFAULT_MAX_EVENT_BYTES); // 4 takes of a short text: ~8 KB
    const dialogue = await runTakes(Array.from({ length: 40 }, (_, i) => line(i)).join('\n'), 40);
    expect(dialogue).toBeGreaterThan(DEFAULT_MAX_EVENT_BYTES);
    const worst = await runTakes('é'.repeat(8000), 100);
    expect(worst).toBeLessThan(STUDIO_MAX_EVENT_BYTES);
    // eslint-disable-next-line no-console
    console.info(`message.updated (4 takes) : short ${short} B, dialogue of 40 turns ${dialogue} B, worst case ${worst} B`);
  });

  it('sends the library voices the generation uses to the engine (default voice and cast), and an empty library when none is used', async () => {
    const clip = await s.voices.create({ id: 'v1', name: 'Alice', kind: 'clone', filename: 'voice_v1.wav', transcript: 'bonjour' });
    await s.voices.create({ id: 'v2', name: 'Marc', kind: 'clone', filename: 'voice_v2.wav' });
    await s.voices.create({ id: 'v3', name: 'Inutilisée', kind: 'clone', filename: 'voice_v3.wav' });
    await s.messages.create({ id: 'u1', conversationId: 'c1', role: 'user', prompt: 'Alice : salut' });
    await s.messages.create({
      id: 'a1', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'Alice : salut', modelId: 'tts', status: 'queued',
      params: { voice: { source: 'library', id: 'v1' }, cast: { Marc: { source: 'library', id: 'v2' }, Zoé: { source: 'preset', id: 'ff_siwis' }, Gone: { source: 'library', id: 'nope' } } },
    });
    s.queue.enqueue({ id: 'a1', conversationId: 'c1' }, 'audio');
    await s.queue.idle();
    const body = s.engine.calls.find((c) => c.path === '/engine/v1/jobs')?.options?.body as { voices: Record<string, { path: string; transcript: string; name: string }> };
    expect(Object.keys(body.voices).sort()).toEqual(['v1', 'v2']);
    expect(body.voices.v1).toMatchObject({ transcript: 'bonjour', name: 'Alice' });
    expect(body.voices.v1.path).toMatch(/uploads\/voice_v1\.wav$/);
    expect(clip.id).toBe('v1');

    await s.messages.create({ id: 'a2', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'x', modelId: 'tts', status: 'queued', params: { voice: { source: 'preset', id: 'ff_siwis' } } });
    s.queue.enqueue({ id: 'a2', conversationId: 'c1' }, 'audio');
    await s.queue.idle();
    s.emit('job.done', { job_id: 'a1', outputs: 0 });
    await s.queue.idle();
    const second = s.engine.calls.filter((c) => c.path === '/engine/v1/jobs').at(-1)?.options?.body as { voices?: unknown };
    expect(second.voices).toEqual({});
  });

  it('does not add voices to an image job', async () => {
    await s.messages.create({ id: 'u1', conversationId: 'c1', role: 'user', prompt: 'p' });
    await s.messages.create({ id: 'a1', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'p', modelId: 'demo', status: 'queued', params: { voice: { source: 'library', id: 'v1' } } });
    s.queue.enqueue({ id: 'a1', conversationId: 'c1' }, 'image');
    await s.queue.idle();
    const body = s.engine.calls.find((c) => c.path === '/engine/v1/jobs')?.options?.body as Record<string, unknown>;
    expect('voices' in body).toBe(false);
  });
});

describe('libraryVoiceIds and jobVoices', () => {
  it('collects each library voice once, ignoring presets, malformed references and non-objects', () => {
    expect(libraryVoiceIds({})).toEqual([]);
    expect(libraryVoiceIds({ voice: { source: 'library', id: 'a' }, cast: { X: { source: 'library', id: 'a' }, Y: { source: 'library', id: 'b' }, Z: { source: 'preset', id: 'c' }, W: 'bad', V: null } })).toEqual(['a', 'b']);
    expect(libraryVoiceIds({ voice: 'a', cast: ['x'] })).toEqual([]);
    expect(libraryVoiceIds({ voice: { source: 'library', id: '' } })).toEqual([]);
  });

  it('skips a voice without a sample file', () => {
    process.env.APP_DATA_DIR = process.env.APP_DATA_DIR ?? '/tmp/x';
    const rows = [{ id: 'a', name: 'A', filename: null, transcript: '' }, { id: 'b', name: 'B', filename: 'voice_b.wav', transcript: 't' }];
    expect(Object.keys(jobVoices(rows as never))).toEqual(['b']);
  });
});
