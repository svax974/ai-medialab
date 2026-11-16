/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Subject } from 'rxjs';
import { DataSource } from 'typeorm';
import { EngineBusyGate } from 'src/modules/studio-core';
import { createTestDataSource } from 'src/testing/testDataSource';
import { TranscriptEntity } from '../entities/TranscriptEntity';
import type { TranscriptEvent } from '../types/transcriptTypes';
import { TranscriptController } from '../controllers/TranscriptController';
import { TranscriptQueue, transcriptDir } from './TranscriptQueue';
import { TranscriptService } from './TranscriptService';
import { TranscriptStore } from './TranscriptStore';

class FakeClient {
  requests = 0;
  stopped = 0;
  hold = false;
  fail = false;
  async ready(): Promise<boolean> { return false; }
  async *read(_body: unknown, signal: AbortSignal): AsyncGenerator<TranscriptEvent> {
    this.requests++;
    if (this.fail) throw new Error('test refusal');
    yield { type: 'prepared', chunks: 2, duration: 120, title: '' };
    yield { type: 'segment', index: 0, text: 'Bonjour', language: 'fr', done: 60 };
    if (this.hold) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    else yield { type: 'segment', index: 1, text: 'Le reste', language: 'fr', done: 120 };
    yield { type: 'done' };
  }
  async stop(): Promise<void> { this.stopped++; }
}

describe('transcription lifecycle with SQLite and a fake engine', () => {
  let db: DataSource;
  let service: TranscriptService;
  let store: TranscriptStore;
  let queue: TranscriptQueue;
  let client: FakeClient;
  let gate: EngineBusyGate;
  let root: string;
  let oldDir: string | undefined;
  let published: { name: string; data: object }[];
  let session: { active: boolean };
  let relay: { connected: boolean; linkChanges$: Subject<boolean> };
  const model = { id: 'whisper-small', name: 'Whisper', kind: 'audio', audio: { task: 'stt' }, ready: true, engine_available: true };

  beforeEach(async () => {
    oldDir = process.env.APP_DATA_DIR;
    root = mkdtempSync(join(tmpdir(), 'transcription-'));
    process.env.APP_DATA_DIR = root;
    db = await createTestDataSource();
    store = new TranscriptStore(db.getRepository(TranscriptEntity));
    client = new FakeClient();
    gate = new EngineBusyGate();
    published = [];
    const events = { publish: (name: string, data: object) => published.push({ name, data }) };
    relay = { connected: true, linkChanges$: new Subject<boolean>() };
    queue = new TranscriptQueue(store, client as never, gate, { occupied: false, idle$: new Subject<void>() } as never, events as never, { onStop: () => () => undefined } as never, relay as never);
    session = { active: false };
    service = new TranscriptService(store, queue, { catalog: async () => ({ models: [model] }) } as never, events as never, session as never);
  });
  afterEach(async () => {
    await queue.onModuleDestroy();
    await db.destroy();
    await rm(root, { recursive: true, force: true });
    if (oldDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = oldDir;
  });

  const create = async () => {
    const file = join(root, `upload-${Date.now()}.mp4`);
    writeFileSync(file, 'fake');
    return service.create({ filePath: file, originalName: 'film.mp4', language: null });
  };
  const wait = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
    throw new Error('Timed out');
  };

  it('keeps the complete text, searchable history and edits, without putting text in events or list summaries', async () => {
    const row = await create();
    await wait(async () => (await service.detail(row.id)).status === 'done');
    expect(await service.detail(row.id)).toMatchObject({ text: 'Bonjour\n\nLe reste', duration: 120, progress: 100 });
    expect(await service.list('reste')).toHaveLength(1);
    expect((await service.list())[0]).not.toHaveProperty('text');
    expect(published.filter((event) => event.name === 'transcription.updated').every((event) => !('text' in event.data))).toBe(true);
    expect((await service.edit(row.id, 'Correction')).text).toBe('Correction');
    const controller = new TranscriptController(service);
    let body = '';
    const headers: Record<string, string> = {};
    await controller.export(row.id, { setHeader: (key: string, value: string) => { headers[key] = value; }, send: (value: string) => { body = value; } } as never);
    expect(body).toBe('Correction');
    expect(headers['Content-Disposition']).toContain('film.txt');
    await service.remove(row.id);
    expect(existsSync(transcriptDir(row.id))).toBe(false);
    await expect(service.detail(row.id)).rejects.toThrow();
  });

  it('waits for the engine gate and can cancel a queued job without starting it', async () => {
    gate.tryAcquire('chat');
    const row = await create();
    expect((await service.detail(row.id)).status).toBe('queued');
    await expect(service.edit(row.id, 'x')).rejects.toThrow();
    await expect(service.retry(row.id)).rejects.toThrow();
    await service.cancel(row.id);
    expect(client.requests).toBe(0);
    expect((await service.detail(row.id)).status).toBe('cancelled');
    gate.release('chat');
  });

  it('cancels the running worker, retaining partial text and releasing the gate before a retry', async () => {
    client.hold = true;
    const row = await create();
    await wait(async () => Boolean((await service.detail(row.id)).text));
    expect(gate.heldBy).toBe('transcription');
    await service.cancel(row.id);
    expect(await service.detail(row.id)).toMatchObject({ status: 'cancelled', text: 'Bonjour' });
    expect(client.stopped).toBeGreaterThan(0);
    expect(gate.busy).toBe(false);
    client.hold = false;
    await service.retry(row.id);
    await wait(async () => (await service.detail(row.id)).status === 'done');
    expect((await service.detail(row.id)).text).toBe('Bonjour\n\nLe reste');
  });

  it('records failures, recovers interrupted jobs, and restarts waiting ones at bootstrap', async () => {
    client.fail = true;
    const row = await create();
    await wait(async () => (await service.detail(row.id)).status === 'failed');
    expect((await service.detail(row.id)).error).toContain('test refusal');
    await wait(async () => !queue.isActive(row.id));
    const temporary = join(transcriptDir(row.id), 'transcribe-leftover');
    mkdirSync(temporary); writeFileSync(join(temporary, 'chunk.wav'), 'private audio');
    await store.update(row.id, { status: 'running', text: 'partial' });
    await service.onApplicationBootstrap();
    expect(await service.detail(row.id)).toMatchObject({ status: 'failed', text: 'partial' });
    expect(existsSync(temporary)).toBe(false);
    client.fail = false;
    await store.update(row.id, { status: 'queued', text: '' });
    await service.onApplicationBootstrap();
    await wait(async () => (await service.detail(row.id)).status === 'done');
  });

  it('normalizes YouTube links and refuses ambiguous, invalid or unsafe sources', async () => {
    gate.tryAcquire('chat');
    const row = await service.create({ url: 'https://youtu.be/abcdefghijk?list=discard', language: 'fr' });
    expect((await service.detail(row.id)).source_url).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    await expect(service.create({ url: 'https://localhost/', language: null })).rejects.toThrow();
    await expect(service.create({ language: null })).rejects.toThrow();
    await expect(service.create({ url: 'x', filePath: 'x', language: null })).rejects.toThrow();
    await service.cancel(row.id);
    await expect(service.edit(row.id, 1)).rejects.toThrow();
    gate.release('chat');
  });

  it('always cleans raw upload files when boundary validation fails', async () => {
    const controller = new TranscriptController(service);
    const file = join(root, 'raw-upload');
    writeFileSync(file, 'fake');
    await expect(controller.create({ language: '../bad' }, { path: file, originalname: 'film.mp4' } as never)).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it('refuses persistent creation, edits and retries server-side in a private session', async () => {
    session.active = true;
    await expect(service.create({ url: 'https://youtu.be/abcdefghijk', language: null })).rejects.toThrow();
    await expect(service.edit('x', 'text')).rejects.toThrow();
    await expect(service.retry('x')).rejects.toThrow();
    expect(await service.list()).toEqual([]);
    expect(client.requests).toBe(0);
  });
  it('keeps queued work until the engine connects and clears the entire waiting line on emergency stop', async () => {
    relay.connected = false;
    const first = await create();
    const second = await service.create({ url: 'https://youtu.be/abcdefghijk', language: null });
    expect(client.requests).toBe(0);
    expect(await queue.cancelAll()).toBe(2);
    relay.connected = true;
    relay.linkChanges$.next(true);
    expect(client.requests).toBe(0);
    expect((await service.detail(first.id)).status).toBe('cancelled');
    expect((await service.detail(second.id)).status).toBe('cancelled');
    await service.retry(first.id);
    await wait(async () => (await service.detail(first.id)).status === 'done');
  });

  it('sweeps temporary audio even when a crash followed a terminal database update', async () => {
    const row = await create();
    await wait(async () => !queue.isActive(row.id));
    const temporary = join(transcriptDir(row.id), 'transcribe-after-completion');
    mkdirSync(temporary); writeFileSync(join(temporary, 'chunk.wav'), 'audio');
    await service.onApplicationBootstrap();
    expect(existsSync(temporary)).toBe(false);
    expect((await service.detail(row.id)).status).toBe('done');
  });

});
