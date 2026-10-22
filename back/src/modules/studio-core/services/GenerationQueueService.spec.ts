/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { QueueController } from '../controllers/QueueController';
import { interruptedByEngine } from '../types/jobTypes';
import { buildStudio, engineDown, engineError, type Studio } from 'src/testing/studioHarness';
import { interruptedMessage } from './MessageService';

const OUTPUT = {
  index: 0, media: 'image', asset_id: 'asset-1', path: '/data/outputs/a1_0.png', filename: 'a1_0.png', thumb: 'asset-1.webp',
  width: 512, height: 768, seed: 7, duration: null, meta: { model_id: 'demo', prompt: 'p', steps: 2 },
};

describe('GenerationQueueService', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    await s.conversations.create({ title: 'c' }).then(async (c) => {
      await dataSource.query("UPDATE conversations SET id = 'c1' WHERE id = ?", [c.id]);
    });
    await s.messages.create({ id: 'u1', conversationId: 'c1', role: 'user', prompt: 'p' });
    await s.queue.onApplicationBootstrap();
  });
  afterEach(async () => {
    s.queue.onModuleDestroy();
    await dataSource.destroy();
  });

  const queued = async (id: string) =>
    s.messages.create({ id, conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'p', modelId: 'demo', params: { seeds: [7] }, status: 'queued' });
  const enqueue = async (id: string) => {
    await queued(id);
    s.queue.enqueue({ id, conversationId: 'c1' }, 'image');
    await s.queue.idle();
  };
  const emit = async (name: string, data: Record<string, unknown>) => {
    s.emit(name, data);
    await s.queue.idle();
  };
  const status = async (id: string) => (await s.messages.get(id))?.status;
  const topics = () => s.published.map((e) => e.type);

  it('submits the message to the engine with its prompt, parameters, reference paths and output folder', async () => {
    await s.assets.create({ id: 'r1', kind: 'upload', filename: 'r1.png' });
    await s.assets.create({ id: 'r2', kind: 'upload', filename: 'r2.png' });
    await dataSource.query("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u1', 'r2', 0), ('u1', 'r1', 1)");
    await enqueue('a1');
    const body = s.engine.calls.find((c) => c.path === '/engine/v1/jobs')?.options?.body as Record<string, unknown>;
    expect(body).toMatchObject({ job_id: 'a1', kind: 'image', model_id: 'demo', prompt: 'p', params: { seeds: [7] } });
    expect((body.inputs as string[]).map((p) => p.split('/').pop())).toEqual(['r2.png', 'r1.png']);
    expect(String(body.output_dir)).toMatch(/outputs$/);
    expect(await status('a1')).toBe('queued');
    expect(s.queue.snapshot()).toEqual({ current: 'a1', pending: [] });
  });

  it('follows the job through loading, running and done, registering assets and telling the browser', async () => {
    await enqueue('a1');
    await emit('job.started', { job_id: 'a1', kind: 'image', model_id: 'demo', params: { width: 512, seeds: [7] }, started_at: 1 });
    expect(await s.messages.get('a1')).toMatchObject({ status: 'loading', params: { width: 512, seeds: [7] } });
    expect((await s.messages.get('a1'))?.started_at).toBeGreaterThan(0);

    await emit('job.progress', { job_id: 'a1', phase: 'loading', load_started_at: 5 });
    expect(await status('a1')).toBe('loading');
    await emit('job.progress', { job_id: 'a1', phase: 'running', count: 1 });
    expect(await status('a1')).toBe('running');
    await emit('job.progress', { job_id: 'a1', index: 0, step: 1, total: 2, eta: 3.5, seconds_per_step: 1.2, stage: null, preview_url: null });
    await emit('job.preview', { job_id: 'a1', index: 0, url: '/media/previews/a1_0_1.jpg?t=1' });
    await emit('job.output', { job_id: 'a1', ...OUTPUT });
    await emit('job.done', { job_id: 'a1', outputs: 1 });

    const message = await s.messages.get('a1');
    expect(message).toMatchObject({ status: 'done', error: null });
    expect(message?.finished_at).toBeGreaterThan(0);
    expect(message?.outputs[0]).toMatchObject({
      id: 'asset-1', media: 'image', url: '/media/outputs/a1_0.png', thumb_url: '/media/thumbs/asset-1.webp', width: 512,
      height: 768, seed: 7, conversation_id: 'c1', message_id: 'a1', meta: OUTPUT.meta,
    });
    expect(s.queue.snapshot()).toEqual({ current: null, pending: [] });
    expect(s.queue.progressSnapshot()).toEqual([]);

    const progress = s.published.filter((e) => e.type === 'job.progress').map((e) => e.data);
    expect(progress.at(-1)).toEqual({
      message_id: 'a1', conversation_id: 'c1', phase: 'running', count: 1, index: 0, step: 1, total: 2, eta: 3.5,
      seconds_per_step: 1.2, stage: null, preview_url: '/media/previews/a1_0_1.jpg?t=1', load_started_at: 5,
    });
    expect(topics().filter((t) => t === 'message.updated').length).toBe(3); // loading, running, done
    const image = s.published.find((e) => e.type === 'job.image');
    expect(image?.data).toMatchObject({ message_id: 'a1', conversation_id: 'c1', asset: { id: 'asset-1' } });
    expect(s.published.every((e) => e.topic === `studio.${e.type}`)).toBe(true);
  });

  it('runs one generation at a time and submits the next when the previous ended', async () => {
    await enqueue('a1');
    await enqueue('a2');
    await enqueue('a3');
    expect(s.engine.submitted()).toEqual(['a1']);
    expect(s.queue.snapshot()).toEqual({ current: 'a1', pending: ['a2', 'a3'] });
    await emit('job.done', { job_id: 'a1', outputs: 0 });
    expect(s.engine.submitted()).toEqual(['a1', 'a2']);
    await emit('job.failed', { job_id: 'a2', error: 'Mémoire insuffisante' });
    expect(await s.messages.get('a2')).toMatchObject({ status: 'error', error: 'Mémoire insuffisante' });
    expect(s.engine.submitted()).toEqual(['a1', 'a2', 'a3']);
    await emit('job.cancelled', { job_id: 'a3' });
    expect(await status('a3')).toBe('cancelled');
    expect(s.queue.snapshot()).toEqual({ current: null, pending: [] });
  });

  it('publishes the position of every waiting message when the queue changes', async () => {
    const queueEvents = () => s.queueEvents;
    await enqueue('a1');
    await enqueue('a2');
    await enqueue('a3');
    expect(queueEvents().at(-1)).toEqual({ current: 'a1', queue: ['a2', 'a3'] });
    expect(queueEvents()[0]).toEqual({ current: null, queue: ['a1'] });
    expect(s.queue.publicQueue()).toEqual({ current: 'a1', queue: ['a2', 'a3'] });
    expect(new QueueController(s.queue).get()).toEqual({ current: 'a1', queue: ['a2', 'a3'] }); // GET /api/queue
    await s.queue.cancel('a2');
    await s.queue.idle();
    expect(queueEvents().at(-1)).toEqual({ current: 'a1', queue: ['a3'] });
    await emit('job.done', { job_id: 'a1', outputs: 0 });
    expect(queueEvents().at(-1)).toEqual({ current: 'a3', queue: [] });
    await emit('job.done', { job_id: 'a3', outputs: 0 });
    expect(queueEvents().at(-1)).toEqual({ current: null, queue: [] });
  });

  it('does not repeat a queue event when nothing changed', async () => {
    await enqueue('a1');
    const before = s.queueEvents.length;
    await emit('job.progress', { job_id: 'a1', phase: 'running', step: 1, total: 4 });
    expect(s.queueEvents).toHaveLength(before);
  });

  it('cancels a waiting generation at once without telling the engine', async () => {
    await enqueue('a1');
    await enqueue('a2');
    expect(await s.queue.cancel('a2')).toBe(true);
    expect(await s.messages.get('a2')).toMatchObject({ status: 'cancelled' });
    expect(s.engine.paths('post')).not.toContain('/engine/v1/jobs/{job_id}/cancel');
    await emit('job.done', { job_id: 'a1', outputs: 0 });
    expect(s.engine.submitted()).toEqual(['a1']);
  });

  it('asks the engine to stop the running generation and settles on job.cancelled', async () => {
    await enqueue('a1');
    await enqueue('a2');
    expect(await s.queue.cancel('a1')).toBe(true);
    expect(s.engine.calls.at(-1)).toMatchObject({ path: '/engine/v1/jobs/{job_id}/cancel', options: { params: { job_id: 'a1' } } });
    expect(await status('a1')).toBe('queued'); // the engine's event decides
    await emit('job.cancelled', { job_id: 'a1', outputs: 0 });
    expect(await status('a1')).toBe('cancelled');
    expect(s.engine.submitted()).toEqual(['a1', 'a2']);
  });

  it('answers false when the message is not queued or running, or when the engine says it just ended', async () => {
    expect(await s.queue.cancel('nope')).toBe(false);
    await enqueue('a1');
    s.engine.on('POST /engine/v1/jobs/{job_id}/cancel', () => { throw engineError(409, 'Ce job n\'est plus en cours.'); });
    expect(await s.queue.cancel('a1')).toBe(false);
  });

  it('a cancellation asked while the job is being handed to the engine is applied right after', async () => {
    await queued('a1');
    let release: () => void = () => undefined;
    s.engine.on('POST /engine/v1/jobs', () => new Promise((resolve) => { release = () => resolve({}); }));
    s.queue.enqueue({ id: 'a1', conversationId: 'c1' }, 'image');
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.queue.cancel('a1')).toBe(true);
    release();
    await s.queue.idle();
    expect(s.engine.paths('post')).toContain('/engine/v1/jobs/{job_id}/cancel');
  });

  it('fails the message when the engine refuses the job or cannot be reached, and moves on', async () => {
    s.engine.on('POST /engine/v1/jobs', (c) => {
      if (c.options?.body?.job_id === 'a1') throw engineError(422, 'Modèle inconnu');
      if (c.options?.body?.job_id === 'a2') throw engineDown();
      return {};
    });
    await enqueue('a1');
    await enqueue('a2');
    await enqueue('a3');
    expect(await s.messages.get('a1')).toMatchObject({ status: 'error', error: 'Modèle inconnu' });
    expect(await s.messages.get('a2')).toMatchObject({ status: 'error', error: 'Le moteur est injoignable.' });
    expect(s.queue.snapshot().current).toBe('a3');
  });

  it('skips a message deleted or settled while it waited', async () => {
    await enqueue('a1');
    await enqueue('a2');
    await s.messages.remove('a2');
    await emit('job.done', { job_id: 'a1', outputs: 0 });
    expect(s.engine.submitted()).toEqual(['a1']);
    expect(s.queue.snapshot()).toEqual({ current: null, pending: [] });
  });

  it('ignores events of jobs it does not own and non-job events', async () => {
    await enqueue('a1');
    await emit('job.done', { job_id: 'legacy-1' });
    await emit('engine.status', { job_id: 'a1' });
    await emit('job.progress', { job_id: 'other', phase: 'running' });
    expect(await status('a1')).toBe('queued');
    expect(s.published.filter((e) => e.type === 'job.progress')).toEqual([]);
  });

  it('does not register the same output twice and removes the file of a message deleted meanwhile', async () => {
    await enqueue('a1');
    await emit('job.output', { job_id: 'a1', ...OUTPUT });
    await emit('job.output', { job_id: 'a1', ...OUTPUT });
    expect((await s.messages.get('a1'))?.outputs).toHaveLength(1);
    expect(topics().filter((t) => t === 'job.image')).toHaveLength(1);
    await s.messages.remove('a1');
    await emit('job.output', { job_id: 'a1', ...OUTPUT, asset_id: 'asset-2', filename: 'a1_1.png', thumb: 'asset-2.webp' });
    expect(await s.assets.get('asset-2')).toBeNull();
    expect(s.engine.calls.at(-1)?.options?.body).toEqual({ files: [{ folder: 'outputs', filename: 'a1_1.png', thumb: 'asset-2.webp' }] });
  });

  it('a message deleted while running ends quietly and the queue goes on', async () => {
    await enqueue('a1');
    await enqueue('a2');
    await s.messages.remove('a1');
    await emit('job.cancelled', { job_id: 'a1' });
    expect(s.engine.submitted()).toEqual(['a1', 'a2']);
    expect(topics()).not.toContain('message.updated');
  });

  describe('startup and reconnection', () => {
    it('fails the generations left busy by the last stop, as the legacy server did', async () => {
      await s.messages.create({ id: 'old1', conversationId: 'c1', role: 'assistant', status: 'running' });
      await s.messages.create({ id: 'old2', conversationId: 'c1', role: 'assistant', status: 'queued' });
      await s.messages.create({ id: 'ok', conversationId: 'c1', role: 'assistant', status: 'done' });
      const other = buildStudio(dataSource);
      await other.queue.onApplicationBootstrap();
      other.queue.onModuleDestroy();
      expect(await s.messages.get('old1')).toMatchObject({ status: 'error', error: interruptedMessage() });
      expect(await status('old2')).toBe('error');
      expect(await status('ok')).toBe('done');
    });

    it('marks the running message failed when the engine no longer knows the job (it restarted)', async () => {
      await enqueue('a1');
      await enqueue('a2');
      s.engine.on('GET /engine/v1/jobs/{job_id}', () => { throw engineError(404, 'Job inconnu.'); });
      s.relay.linkChanges$.next(true);
      await s.queue.idle();
      expect(await s.messages.get('a1')).toMatchObject({ status: 'error', error: interruptedByEngine() });
      expect(s.engine.submitted()).toEqual(['a1', 'a2']);
    });

    it('settles from the engine record when the job ended while the stream was down', async () => {
      await enqueue('a1');
      s.engine.on('GET /engine/v1/jobs/{job_id}', () => ({ job_id: 'a1', state: 'done', error: null, outputs: [OUTPUT] }));
      s.relay.linkChanges$.next(true);
      await s.queue.idle();
      const message = await s.messages.get('a1');
      expect(message?.status).toBe('done');
      expect(message?.outputs.map((o) => o.id)).toEqual(['asset-1']);
    });

    it('keeps waiting when the engine still runs the job', async () => {
      await enqueue('a1');
      s.engine.on('GET /engine/v1/jobs', () => ({ jobs: [{ job_id: 'a1', state: 'running', outputs: [] }] }));
      s.relay.linkChanges$.next(true);
      await s.queue.idle();
      expect(s.queue.snapshot().current).toBe('a1');
      expect(await status('a1')).toBe('queued');
    });

    it('cancels engine jobs of an earlier run that Nest knows, and leaves the others alone', async () => {
      await s.messages.create({ id: 'stale', conversationId: 'c1', role: 'assistant', status: 'error' });
      s.engine.on('GET /engine/v1/jobs', () => ({ jobs: [{ job_id: 'stale', state: 'running' }, { job_id: 'legacy-ui', state: 'queued' }] }));
      s.relay.linkChanges$.next(true);
      await s.queue.idle();
      const cancels = s.engine.calls.filter((c) => c.path === '/engine/v1/jobs/{job_id}/cancel').map((c) => c.options?.params?.job_id);
      expect(cancels).toEqual(['stale']);
    });

    it('submits what was waiting when the engine comes back', async () => {
      s.engine.on('POST /engine/v1/jobs', () => { throw engineDown(); });
      await enqueue('a1');
      expect(await status('a1')).toBe('error');
      s.engine.on('POST /engine/v1/jobs', () => ({}));
      await enqueue('a2');
      expect(s.queue.snapshot().current).toBe('a2');
    });
  });
});
