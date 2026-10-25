/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildStudio, engineError, type Studio } from 'src/testing/studioHarness';

const VIDEO_CHECK = { kind: 'video', name: 'Wan', max_count: 2, default_params: { steps: 40, seconds: 5, resolution: '480p', aspect: '16:9', fast_decode: true } };

/** What the engine reports for a clip: poster, size, duration, frame rate, task. */
const clip = (index: number) => ({
  index, media: 'video', asset_id: `clip-${index}`, path: `/d/outputs/m1_${index}.mp4`, filename: `m1_${index}.mp4`, thumb: `clip-${index}.webp`,
  width: 832, height: 480, seed: 40 + index, duration: 5.0625,
  meta: { model_id: 'wan', prompt: 'un chat', steps: 40, guidance: 5, seconds: 61.2, fps: 16, frames: 81, has_audio: false, video_seconds: 5.0625, task: 'i2v', strength: null },
});

describe('video generations', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    s.engine.on('POST /engine/v1/jobs/check', () => VIDEO_CHECK);
    await s.queue.onApplicationBootstrap();
  });
  afterEach(async () => {
    s.queue.onModuleDestroy();
    await s.queue.idle();
    await dataSource.destroy();
  });

  const submitted = () => s.engine.calls.filter((c) => c.path === '/engine/v1/jobs').at(-1)?.options?.body as Record<string, unknown>;

  async function attach(): Promise<string[]> {
    await s.assets.create({ id: 'start', kind: 'upload', filename: 'start.png', media: 'image' });
    await s.assets.create({ id: 'end', kind: 'upload', filename: 'end.png', media: 'image' });
    await s.assets.create({ id: 'src', kind: 'upload', filename: 'src.mp4', media: 'video', duration: 4, meta: { fps: 24 } });
    return ['start', 'end', 'src'];
  }

  it('creates a video conversation, asks the engine with the media of the start, end and source, and caps the clips at two', async () => {
    const result = await s.generations.create({
      conversationId: null, prompt: 'un chat qui court', modelId: 'wan', params: { seed: 40, seconds: 3, aspect: '9:16', resolution: '720p', fast_decode: false }, referenceIds: await attach(), count: 4,
    });
    const check = s.engine.calls.find((c) => c.path === '/engine/v1/jobs/check');
    expect(check?.options?.body).toEqual({ model_id: 'wan', reference_media: ['image', 'image', 'video'] });
    expect((await s.conversations.getSummary(result.conversation_id))?.mode).toBe('video');
    // The model's defaults, then the composer's values; one seed per clip, counting up from the fixed one.
    expect(result.assistant_message.params).toMatchObject({ steps: 40, seconds: 3, aspect: '9:16', resolution: '720p', fast_decode: false, count: 2, seeds: [40, 41] });
    expect(result.user_message.references.map((a) => a.id)).toEqual(['start', 'end', 'src']);
  });

  it('submits the job with the files in the order of the composer (start, end, source), the output folder and no voices', async () => {
    await s.generations.create({ conversationId: null, prompt: 'p', modelId: 'wan', params: {}, referenceIds: await attach(), count: 1 });
    await s.queue.idle();
    const body = submitted();
    expect(body).toMatchObject({ kind: 'video', model_id: 'wan', prompt: 'p' });
    expect((body.inputs as string[]).map((path) => path.split('/').pop())).toEqual(['start.png', 'end.png', 'src.mp4']);
    expect(body.output_dir).toMatch(/outputs$/);
    expect('voices' in body).toBe(false);
  });

  it('passes the model refusals (start image or source video required) back as they are', async () => {
    s.engine.on('POST /engine/v1/jobs/check', () => {
      throw engineError(422, "Wan a besoin d'une image de départ.");
    });
    await expect(s.generations.create({ conversationId: null, prompt: 'p', modelId: 'wan', params: {}, referenceIds: [], count: 1 })).rejects.toMatchObject({ status: 422 });
    expect(s.engine.submitted()).toEqual([]);
    expect(await s.conversations.list({})).toEqual([]);
  });

  it('follows a clip from the job to the browser: resolved parameters, stages, then the poster, duration and frame rate of the asset', async () => {
    const created = await s.generations.create({ conversationId: null, prompt: 'un chat', modelId: 'wan', params: {}, referenceIds: [], count: 1 });
    const id = created.assistant_message.id;
    await s.queue.idle();
    s.emit('job.started', { job_id: id, kind: 'video', model_id: 'wan', params: { width: 832, height: 480, frames: 81, fps: 16, seconds: 5.06, resolution: '480p', aspect: '16:9', task: 'i2v', seeds: [40], count: 1 }, started_at: 1 });
    await s.queue.idle();
    s.emit('job.progress', { job_id: id, phase: 'running', stage: 'decode', index: 0 });
    await s.queue.idle();
    s.emit('job.progress', { job_id: id, phase: 'running', stage: 'encode', index: 0 });
    await s.queue.idle();
    s.emit('job.output', { job_id: id, ...clip(0) });
    await s.queue.idle();
    s.emit('job.done', { job_id: id, outputs: 1 });
    await s.queue.idle();

    const stages = s.published.filter((e) => e.type === 'job.progress').map((e) => e.data.stage);
    expect(stages).toEqual(['decode', 'encode']);
    const image = s.published.find((e) => e.type === 'job.image');
    expect(image?.data.asset).toMatchObject({
      id: 'clip-0', kind: 'generated', media: 'video', url: '/media/outputs/m1_0.mp4', thumb_url: '/media/thumbs/clip-0.webp', width: 832, height: 480, duration: 5.0625, fps: 16, seed: 40,
    });
    const done = s.published.filter((e) => e.type === 'message.updated').at(-1)?.data as { status: string; params: Record<string, unknown>; outputs: { media: string }[] };
    expect(done.status).toBe('done');
    expect(done.params).toMatchObject({ width: 832, height: 480, frames: 81, task: 'i2v', resolution: '480p' });
    expect(done.outputs.map((o) => o.media)).toEqual(['video']);
    // The gallery lists the clip by its media.
    const page = await s.assets.list({ kind: 'generated', media: 'video' });
    expect(page.items.map((a) => a.id)).toEqual(['clip-0']);
    expect((await s.assets.list({ kind: 'generated', media: 'image' })).items).toEqual([]);
  });

  it('retries a video with the media of its references and keeps or redraws the seeds', async () => {
    const created = await s.generations.create({ conversationId: null, prompt: 'p', modelId: 'wan', params: { seed: 7 }, referenceIds: await attach(), count: 2 });
    await s.queue.idle();
    s.emit('job.done', { job_id: created.assistant_message.id, outputs: 0 });
    await s.queue.idle();
    const same = await s.generations.retry(created.assistant_message.id, { keepSeed: true, forceMemory: false });
    expect(same.params).toMatchObject({ seeds: [7, 8] });
    const check = s.engine.calls.filter((c) => c.path === '/engine/v1/jobs/check').at(-1);
    expect(check?.options?.body).toEqual({ model_id: 'wan', reference_media: ['image', 'image', 'video'] });
    const fresh = await s.generations.retry(created.assistant_message.id, { keepSeed: false, forceMemory: false });
    expect((fresh.params.seeds as number[]).length).toBe(2);
    expect(fresh.params.seeds).not.toEqual([7, 8]);
  });
});
