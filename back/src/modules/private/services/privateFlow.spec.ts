/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { engineError } from 'src/testing/studioHarness';
import { buildPrivate, type PrivateHarness } from '../testing/privateHarness';

const SENTINEL = 'SENTINELLE-prompt-privé-7f3a91';
const TABLES = ['conversations', 'messages', 'message_refs', 'assets'];

/** Everything that reached a log, whatever the logger: the standard streams are captured for the length of a test. */
function captureLogs(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spies = [jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')].map((spy) =>
    spy.mockImplementation(((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as never));
  return { text: () => chunks.join(''), restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe('private generation: nothing is kept, nothing is told', () => {
  let dataSource: DataSource;
  let p: PrivateHarness;
  let logs: ReturnType<typeof captureLogs>;

  const rows = async (): Promise<Record<string, number>> =>
    Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, Number((await dataSource.query(`SELECT COUNT(*) AS n FROM ${t}`))[0].n)])));
  /** The two chains hand work to each other (the queue's idle signal wakes the private one): let them settle. */
  const settle = async () => { for (let i = 0; i < 3; i += 1) { await p.queue.idle(); await p.generations.idle(); } };
  const emit = async (name: string, data: Record<string, unknown>) => { p.emit(name, data); await settle(); };
  const submittedBody = () => p.engine.calls.filter((c) => c.path === '/engine/v1/jobs').map((c) => c.options?.body as Record<string, unknown>).at(-1) as Record<string, unknown>;
  const everythingTold = () => JSON.stringify([p.published, p.queueEvents, p.streamed]);

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    p = buildPrivate(dataSource);
    p.session.onModuleInit();
    p.engine.on('POST /engine/v1/media/ingest', (call) => {
      const body = call.options?.body as { asset_id: string; private_dir: string };
      writeFileSync(join(body.private_dir, 'inputs', `${body.asset_id}.png`), 'png');
      writeFileSync(join(body.private_dir, 'thumbs', `${body.asset_id}.webp`), 'webp');
      return { media: 'image', filename: `${body.asset_id}.png`, thumb: `${body.asset_id}.webp`, width: 30, height: 20, meta: {} };
    });
    logs = captureLogs();
  });
  afterEach(async () => {
    logs.restore();
    await p.session.end();
    p.generations.onModuleDestroy();
    await dataSource.destroy();
  });

  /** Plays the engine: the job starts, previews, produces a file in the session folder and ends. */
  async function runToTheEnd(jobId: string): Promise<void> {
    const body = submittedBody();
    const outputs = join(String(body.output_dir));
    writeFileSync(join(outputs, `${jobId}_0.png`), 'png');
    writeFileSync(join(String(body.private_dir), 'thumbs', 'out1.webp'), 'webp');
    await emit('job.started', { job_id: jobId, params: { steps: 2, seeds: [7] } });
    await emit('job.progress', { job_id: jobId, phase: 'running', step: 1, total: 2 });
    await emit('job.preview', { job_id: jobId, url: `/media/private/${p.session.sessionId}/previews/${jobId}_0_1.jpg` });
    await emit('job.output', { job_id: jobId, index: 0, media: 'image', asset_id: 'out1', path: join(outputs, `${jobId}_0.png`), filename: `${jobId}_0.png`, thumb: 'out1.webp', width: 64, height: 64, seed: 7, meta: { model_id: 'demo', steps: 2 } });
    await emit('job.done', { job_id: jobId, outputs: 1 });
  }

  it('a whole private generation leaves no row, no file outside the session and no word in any log or event', async () => {
    const before = await rows();
    p.session.start();
    const ref = await p.uploads.ingest({ path: join(p.dataDir, 'raw'), originalName: `photo-${SENTINEL}.png`, mimeType: 'image/png' });
    const created = await p.generations.create({ conversationId: null, prompt: SENTINEL, modelId: 'demo', params: { negative_prompt: SENTINEL }, referenceIds: [ref.id], count: 1 });
    await settle();
    const jobId = created.assistant_message.id;
    const body = submittedBody();
    expect(body).toMatchObject({ job_id: jobId, kind: 'image', prompt: SENTINEL });
    expect(String(body.private_dir)).toBe(p.session.dir);
    expect(String(body.output_dir).startsWith(p.session.dir)).toBe(true);
    expect((body.inputs as string[]).every((i) => i.startsWith(join(p.session.dir, 'inputs')))).toBe(true);

    await runToTheEnd(jobId);

    const detail = p.store.detail(created.conversation_id);
    const assistant = detail?.messages.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({ status: 'done', prompt: SENTINEL });
    expect(assistant?.outputs[0].url).toBe(`/media/private/${p.session.sessionId}/outputs/${jobId}_0.png`);
    expect(detail?.messages.find((m) => m.role === 'user')?.references[0].url.startsWith(`/media/private/${p.session.sessionId}/inputs/`)).toBe(true);

    expect(await rows()).toEqual(before); // no database row
    expect(Object.values(p.listing()).flat()).toEqual([]); // the usual folders stay empty
    expect(everythingTold()).not.toContain(SENTINEL); // not a prompt, not a title, not a file name
    expect(logs.text()).not.toContain(SENTINEL);

    await p.session.end();
    expect(existsSync(p.session.active ? p.session.dir : join(p.dataDir, 'private', 'gone'))).toBe(false);
    expect(readdirSync(join(p.dataDir, 'private')).filter((f) => f !== '.metadata_never_index')).toEqual([]);
    expect(p.store.counts()).toEqual({ conversations: 0, results: 0 });
    expect(p.session.info().active).toBe(false);
  });

  it('an engine failure that echoes the prompt shows no prompt: the message stays safe and nothing is logged', async () => {
    p.session.start();
    p.engine.on('POST /engine/v1/jobs', () => { throw engineError(422, [{ loc: ['body', 'prompt'], input: SENTINEL, msg: 'bad' }]); });
    const created = await p.generations.create({ conversationId: null, prompt: SENTINEL, modelId: 'demo', params: {}, referenceIds: [], count: 1 });
    await settle();
    const message = p.store.getMessage(created.assistant_message.id);
    expect(message?.status).toBe('error');
    expect(JSON.stringify(message?.error)).not.toContain(SENTINEL);
    expect(everythingTold()).not.toContain('bad');
    expect(logs.text()).not.toContain(SENTINEL);
    expect(p.gate.busy).toBe(false);
  });

  it('a generation without a session, or with an unknown conversation, is refused before anything is stored', async () => {
    await expect(p.generations.create({ conversationId: null, prompt: 'p', modelId: 'demo', params: {}, referenceIds: [], count: 1 })).rejects.toThrow('session');
    p.session.start();
    await expect(p.generations.create({ conversationId: 'ghost', prompt: 'p', modelId: 'demo', params: {}, referenceIds: [], count: 1 })).rejects.toThrow('introuvable');
    expect(p.store.counts()).toEqual({ conversations: 0, results: 0 });
    expect(p.engine.submitted()).toEqual([]);
  });

  it('a private generation waits for the normal queue, then holds the engine so that nothing else runs meanwhile', async () => {
    await p.queue.onApplicationBootstrap(); // its startup sweep fails what is queued: before the normal messages exist
    await p.conversations.create({ title: 'n' }).then((c) => dataSource.query("UPDATE conversations SET id = 'c1' WHERE id = ?", [c.id]));
    await p.messages.create({ id: 'u1', conversationId: 'c1', role: 'user', prompt: 'normal' });
    await p.messages.create({ id: 'n1', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'normal', modelId: 'demo', params: { seeds: [1] }, status: 'queued' });
    p.queue.enqueue({ id: 'n1', conversationId: 'c1' }, 'image');
    await p.queue.idle();
    p.session.start();
    const created = await p.generations.create({ conversationId: null, prompt: 'privé', modelId: 'demo', params: {}, referenceIds: [], count: 1 });
    await settle();
    expect(p.engine.submitted()).toEqual(['n1']); // the private one waits

    await emit('job.done', { job_id: 'n1', outputs: 0 });
    expect(p.engine.submitted()).toEqual(['n1', created.assistant_message.id]);
    expect(p.gate.heldBy).toBe('private');
    expect(p.gate.tryAcquire('chat')).toBe(false); // the chat answers busy meanwhile

    await p.messages.create({ id: 'n2', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'normal', modelId: 'demo', params: { seeds: [2] }, status: 'queued' });
    p.queue.enqueue({ id: 'n2', conversationId: 'c1' }, 'image');
    await settle();
    expect(p.engine.submitted()).toEqual(['n1', created.assistant_message.id]); // the normal queue waits for the gauge

    await emit('job.done', { job_id: created.assistant_message.id, outputs: 0 });
    expect(p.gate.busy).toBe(false);
    expect(p.engine.submitted()).toContain('n2');
    p.queue.onModuleDestroy();
  });

  it('ending the session while a job runs cancels it, waits for it, then removes the folder', async () => {
    p.session.start();
    const created = await p.generations.create({ conversationId: null, prompt: SENTINEL, modelId: 'demo', params: {}, referenceIds: [], count: 1 });
    await settle();
    const dir = p.session.dir;
    mkdirSync(join(dir, 'outputs'), { recursive: true });
    writeFileSync(join(dir, 'outputs', 'half.png'), 'x');
    const ending = p.session.end();
    await settle();
    expect(p.engine.calls.some((c) => c.path === '/engine/v1/jobs/{job_id}/cancel' && c.options?.params?.job_id === created.assistant_message.id)).toBe(true);
    expect(existsSync(dir)).toBe(true); // the engine has not let go yet
    p.emit('job.cancelled', { job_id: created.assistant_message.id, outputs: 0 });
    await ending;
    expect(existsSync(dir)).toBe(false);
    expect(p.gate.busy).toBe(false);
  });

  it('deleting a prompt or a conversation erases its files at once', async () => {
    p.session.start();
    const created = await p.generations.create({ conversationId: null, prompt: 'p', modelId: 'demo', params: {}, referenceIds: [], count: 1 });
    await settle();
    await runToTheEnd(created.assistant_message.id);
    const file = join(p.session.dir, 'outputs', `${created.assistant_message.id}_0.png`);
    expect(existsSync(file)).toBe(true);
    await p.generations.removeConversation(created.conversation_id);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(p.session.dir, 'thumbs', 'out1.webp'))).toBe(false);
    expect(p.store.counts()).toEqual({ conversations: 0, results: 0 });
  });

  it('a retry is a new private generation of the same prompt, never stored', async () => {
    p.session.start();
    const created = await p.generations.create({ conversationId: null, prompt: 'p', modelId: 'demo', params: {}, referenceIds: [], count: 1 });
    await settle();
    await runToTheEnd(created.assistant_message.id);
    const retried = await p.generations.retry(created.assistant_message.id, { keepSeed: false, forceMemory: false });
    await settle();
    expect(retried.status).toBe('queued');
    expect(p.engine.submitted()).toHaveLength(2);
    expect(await rows()).toEqual({ conversations: 0, messages: 0, message_refs: 0, assets: 0 });
  });
});
