/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ChildProcess, spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';
import { EngineClient, EngineEventRelay } from 'src/modules/engine';
import { testConfig } from 'src/modules/engine/testing/fakeEngine';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';

/**
 * End to end, no model: the Python engine runs as a child process in demo mode (synthetic images, no GPU, no torch: the
 * hardware probe is switched off) and the Nest studio services talk to it over HTTP and the real event stream.
 * Skipped when `engine/.venv` is absent. Run it under `scripts-local/guarded_run.sh 2`.
 */
const ENGINE_DIR = resolve(__dirname, '../../../../../engine');
const PYTHON = join(ENGINE_DIR, '.venv/bin/python');
const TOKEN = 'e2e-token';
const LAUNCHER = [
  'import app.main as m, uvicorn, sys',
  'm.warm_up = lambda *a, **k: None',
  "uvicorn.run(m.app, host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')",
].join('; ');

const freePort = () =>
  new Promise<number>((res) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => res(port));
    });
  });

const until = async (what: string, check: () => Promise<boolean> | boolean, timeoutMs = 40_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for ${what}`);
};

(existsSync(PYTHON) ? describe : describe.skip)('studio + engine in demo mode (no model)', () => {
  jest.setTimeout(120_000);
  const dataDir = mkdtempSync(join(tmpdir(), 'studio-e2e-'));
  let engineProcess: ChildProcess;
  let dataSource: DataSource;
  let relay: EngineEventRelay;
  let s: Studio;
  let engineLog = '';

  beforeAll(async () => {
    process.env.APP_DATA_DIR = dataDir;
    const port = await freePort();
    engineProcess = spawn(PYTHON, ['-c', LAUNCHER, String(port)], {
      cwd: ENGINE_DIR,
      env: { ...process.env, IMAGEGEN_DEMO: '1', IMAGEGEN_DATA_DIR: dataDir, ENGINE_TOKEN: TOKEN, PYTHONUNBUFFERED: '1' },
    });
    engineProcess.stderr?.on('data', (d: Buffer) => (engineLog += d.toString()));
    engineProcess.stdout?.on('data', (d: Buffer) => (engineLog += d.toString()));
    const config = testConfig(`http://127.0.0.1:${port}`, { token: TOKEN, timeoutMs: 20_000 });
    const client = new EngineClient(config);
    await until('the engine to answer', async () => (await client.get('/engine/v1/status').catch(() => null)) !== null);
    await client.put('/engine/v1/runtime/settings', {
      body: { keep_alive_minutes: -1, previews: true, low_memory: true, hf_token: '', quantize: {}, variant: {} },
    });
    relay = new EngineEventRelay(client, { publish: () => undefined } as never, config);
    relay.start();
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource, client, relay);
    await s.queue.onApplicationBootstrap();
    await until('the event stream', () => relay.connected);
  });

  afterAll(async () => {
    s?.queue.onModuleDestroy();
    relay?.stop();
    engineProcess?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    engineProcess?.kill('SIGKILL');
    await dataSource?.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const statusOf = async (id: string) => (await s.messages.get(id))?.status;
  const settled = (id: string) => async () => ['done', 'error', 'cancelled'].includes((await statusOf(id)) ?? '');
  const params = { steps: 4, megapixels: 0.1, aspect: '1:1' };

  it('generates an image: events, message states, asset row, files and thumbnail', async () => {
    const created = await s.generations.create({ conversationId: null, prompt: 'Un chat roux', modelId: 'demo', params, referenceIds: [], count: 1 });
    const id = created.assistant_message.id;
    expect(created.assistant_message.status).toBe('queued');
    await until('the generation to end', settled(id)).catch((e) => { throw new Error(`${e.message}\n${engineLog}`); });

    const message = await s.messages.get(id);
    expect(message).toMatchObject({ status: 'done', error: null });
    expect(message?.params).toMatchObject({ steps: 4, width: expect.any(Number), seeds: [expect.any(Number)] });
    const [output] = message!.outputs;
    expect(output).toMatchObject({ kind: 'generated', media: 'image', message_id: id, conversation_id: created.conversation_id });
    expect(output.meta).toMatchObject({ model_id: 'demo', prompt: 'Un chat roux', steps: 4 });
    expect(existsSync(join(dataDir, 'outputs', `${id}_0.png`))).toBe(true);
    expect(existsSync(join(dataDir, 'thumbs', `${output.id}.webp`))).toBe(true);
    expect(output.thumb_url).toBe(`/media/thumbs/${output.id}.webp`);

    const events = s.published.filter((e) => (e.data as { message_id?: string }).message_id === id || (e.data as { id?: string }).id === id);
    const statuses = events.filter((e) => e.type === 'message.updated').map((e) => (e.data as { status: string }).status);
    expect(statuses).toEqual(['loading', 'running', 'done']);
    const progress = events.filter((e) => e.type === 'job.progress').map((e) => e.data);
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.some((p) => typeof p.step === 'number' && p.total === 4)).toBe(true);
    expect(progress.some((p) => typeof p.preview_url === 'string')).toBe(true);
    expect(progress.every((p) => p.conversation_id === created.conversation_id)).toBe(true);
    expect(events.filter((e) => e.type === 'job.image')).toHaveLength(1);
    expect((await s.conversations.getSummary(created.conversation_id))).toMatchObject({ busy: false, generation_count: 1 });
  });

  it('runs two generations one after the other, then cancels a running one and a waiting one', async () => {
    const conversation = await s.conversations.create({});
    const make = (prompt: string) => s.generations.create({ conversationId: conversation.id, prompt, modelId: 'demo', params: { ...params, steps: 12 }, referenceIds: [], count: 1 });
    const first = (await make('un')).assistant_message.id;
    const second = (await make('deux')).assistant_message.id;
    const third = (await make('trois')).assistant_message.id;
    expect(s.queue.snapshot()).toEqual({ current: first, pending: [second, third] });
    await until('the first to run', async () => (await statusOf(first)) === 'running');
    expect(await s.generations.cancel(third)).toEqual({ ok: true }); // waiting: at once
    expect(await statusOf(third)).toBe('cancelled');
    await until('the first to end', settled(first));
    expect(await statusOf(first)).toBe('done');
    await until('the second to run', async () => (await statusOf(second)) === 'running');
    await s.generations.cancel(second); // running: the engine stops it after the current step
    await until('the second to be cancelled', settled(second));
    expect(await statusOf(second)).toBe('cancelled');
    expect((await s.messages.get(second))?.outputs).toEqual([]);
    expect(s.queue.snapshot()).toEqual({ current: null, pending: [] });
  });

  it('retries a generation and deletes it: the engine removes the files', async () => {
    const created = await s.generations.create({ conversationId: null, prompt: 'Un phare', modelId: 'demo', params, referenceIds: [], count: 1 });
    await until('the first generation', settled(created.assistant_message.id));
    const again = await s.generations.retry(created.assistant_message.id, { keepSeed: false });
    await until('the retry', settled(again.id));
    const retried = await s.messages.get(again.id);
    expect(retried).toMatchObject({ status: 'done', parent_id: created.user_message.id });
    const file = join(dataDir, 'outputs', `${again.id}_0.png`);
    const thumb = join(dataDir, 'thumbs', `${retried!.outputs[0].id}.webp`);
    expect(existsSync(file) && existsSync(thumb)).toBe(true);
    await s.generations.remove(again.id);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(await s.assets.get(retried!.outputs[0].id)).toBeNull();
  });

  it('uploads a reference through the engine and uses it as input of a generation', async () => {
    mkdirSync(join(dataDir, 'uploads'), { recursive: true });
    const raw = join(dataDir, 'uploads', 'tmp_e2e');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    writeFileSync(raw, png);
    const asset = await s.files.ingest({ path: raw, originalName: 'point.png', mimeType: 'image/png' });
    expect(asset).toMatchObject({ kind: 'upload', media: 'image', width: 1, height: 1, original_name: 'point.png' });
    expect(existsSync(raw)).toBe(false); // consumed by the engine
    expect(existsSync(join(dataDir, 'uploads', asset.url.split('/').pop()!))).toBe(true);

    const created = await s.generations.create({ conversationId: null, prompt: 'avec référence', modelId: 'demo', params, referenceIds: [asset.id], count: 1 });
    await until('the generation', settled(created.assistant_message.id));
    const message = await s.messages.get(created.assistant_message.id);
    expect(message?.status).toBe('done');
    expect(message?.params).toMatchObject({ references_used: 1 });
    expect((await s.assets.get(asset.id))?.conversation_id).toBe(created.conversation_id);
    const rejected = await s.files.ingest({ path: join(dataDir, 'uploads', 'tmp_missing'), originalName: 'x.png', mimeType: 'image/png' }).catch((e: unknown) => e);
    expect((rejected as { getStatus: () => number }).getStatus()).toBe(422);
  });

  it('refuses an unknown model before storing anything', async () => {
    const before = (await s.conversations.list()).length;
    await expect(s.generations.create({ conversationId: null, prompt: 'x', modelId: 'ghost', params: {}, referenceIds: [], count: 1 })).rejects.toThrow(/ghost/);
    expect((await s.conversations.list()).length).toBe(before);
  });
});
