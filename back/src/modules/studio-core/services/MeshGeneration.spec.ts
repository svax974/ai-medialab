/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildStudio, engineError, type Studio } from 'src/testing/studioHarness';

describe('mesh generations', () => {
  let db: DataSource;
  let s: Studio;
  beforeEach(async () => {
    db = await createTestDataSource();
    s = buildStudio(db);
    s.engine.on('POST /engine/v1/jobs/check', () => ({ kind: 'mesh', name: '3D', max_count: 1, default_params: {} }));
    await s.queue.onApplicationBootstrap();
  });
  afterEach(async () => { s.queue.onModuleDestroy(); await s.queue.idle(); await db.destroy(); });

  it('persists and lists a generated GLB from an image-only request', async () => {
    await s.assets.create({ id: 'ref', kind: 'upload', filename: 'ref.png', media: 'image' });
    const created = await s.generations.create({ conversationId: null, prompt: '', modelId: 'mesh', params: {}, referenceIds: ['ref'], count: 2 });
    await s.queue.idle();
    expect((await s.conversations.getSummary(created.conversation_id))?.mode).toBe('mesh');
    expect(created.assistant_message.params.count).toBe(1);
    expect(s.engine.calls.find((c) => c.path === '/engine/v1/jobs/check')?.options?.body).toEqual({ model_id: 'mesh', reference_media: ['image'], prompt: '' });
    const id = created.assistant_message.id;
    s.emit('job.output', { job_id: id, index: 0, media: 'mesh', asset_id: 'glb', path: '/data/outputs/result.glb', filename: 'result.glb', thumb: null, meta: {} });
    s.emit('job.done', { job_id: id });
    await s.queue.idle();
    expect((await s.assets.list({ media: 'mesh' })).items).toEqual([expect.objectContaining({ id: 'glb', media: 'mesh', url: '/media/outputs/result.glb' })]);
    expect((await s.messages.get(id))?.status).toBe('done');
  });

  it('rejects an unsafe output filename and fails the message', async () => {
    const created = await s.generations.create({ conversationId: null, prompt: 'a chair', modelId: 'mesh', params: {}, referenceIds: [], count: 1 });
    await s.queue.idle();
    const id = created.assistant_message.id;
    s.emit('job.output', { job_id: id, index: 0, media: 'mesh', asset_id: 'bad', filename: '../bad.glb', thumb: null, meta: {} });
    s.emit('job.done', { job_id: id });
    await s.queue.idle();
    expect(await s.assets.get('bad')).toBeNull();
    expect((await s.messages.get(id))?.status).toBe('error');
  });

  it('leaves no messages when the engine refuses a task', async () => {
    s.engine.on('POST /engine/v1/jobs/check', () => { throw engineError(422, 'Image required'); });
    await expect(s.generations.create({ conversationId: null, prompt: '', modelId: 'mesh', params: {}, referenceIds: [], count: 1 })).rejects.toMatchObject({ status: 422 });
    expect(await s.conversations.list()).toEqual([]);
  });
});
