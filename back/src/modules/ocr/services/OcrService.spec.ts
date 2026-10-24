/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { EngineBusyGate } from 'src/modules/studio-core';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';
import { OcrDocumentEntity } from '../entities/OcrDocumentEntity';
import { OcrPageEntity } from '../entities/OcrPageEntity';
import type { OcrEvent } from '../types/ocrTypes';
import { OcrQueueService, ocrDir } from './OcrQueueService';
import { OcrService } from './OcrService';
import { OcrStoreService } from './OcrStoreService';
import { OcrEngineError, type OcrReadRequest } from './EngineOcrClient';

const MODEL = {
  id: 'ocr-glm-ocr', name: 'GLM-OCR', kind: 'ocr', ready: true, engine_available: true,
  ocr: { tasks: { text: 'Text Recognition:', table: 'Table Recognition:' }, default_task: 'text', free_prompt: false, languages: '', strengths: [], weaknesses: [], max_tokens: 8192 },
};
const FREE_MODEL = { ...MODEL, id: 'ocr-qwen3-vl-2b', name: 'Qwen3-VL 2B', ocr: { ...MODEL.ocr, free_prompt: true } };

/** A scripted reading: the events the fake engine streams, or an error thrown before the stream. */
class FakeClient {
  requests: OcrReadRequest[] = [];
  script: OcrEvent[] = [
    { type: 'pages', total: 2, document_pages: 5 },
    { type: 'page', index: 1, position: 1, total: 2, text: 'un', truncated: false, usage: { completion_tokens: 3 } },
    { type: 'page', index: 4, position: 2, total: 2, text: 'quatre', truncated: true },
    { type: 'done', pages: 2 },
  ];
  refuse: OcrEngineError | null = null;
  hold: Promise<void> | null = null;

  async *read(body: OcrReadRequest, signal?: AbortSignal): AsyncGenerator<OcrEvent> {
    this.requests.push(body);
    if (this.refuse) throw this.refuse;
    for (const event of this.script) {
      if (this.hold) await Promise.race([this.hold, new Promise((_, no) => signal?.addEventListener('abort', () => no(new Error('aborted'))))]);
      yield event;
    }
  }
}

describe('OcrService', () => {
  let dataSource: DataSource;
  let s: Studio;
  let client: FakeClient;
  let gate: EngineBusyGate;
  let queue: OcrQueueService;
  let service: OcrService;
  let models: unknown[];
  let dir: string;

  const waitFor = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('condition not reached');
  };
  const settled = (id: string) => async () => !['queued', 'running'].includes((await service.detail(id)).status);
  const file = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, 'x');
    return path;
  };

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    dir = mkdtempSync(join(tmpdir(), 'ocr-in-'));
    client = new FakeClient();
    gate = new EngineBusyGate();
    models = [MODEL, FREE_MODEL];
    const store = new OcrStoreService(dataSource.getRepository(OcrDocumentEntity), dataSource.getRepository(OcrPageEntity));
    queue = new OcrQueueService(store, client as never, gate, s.queue, s.events);
    const catalog = { catalog: async () => ({ ocr: { default_model_id: MODEL.id }, models }) };
    service = new OcrService(store, queue, catalog as never, s.events);
  });
  afterEach(async () => {
    queue.onModuleDestroy();
    await dataSource.destroy();
  });

  it('reads a PDF page by page and keeps the text of each page', async () => {
    const created = await service.create({ filePath: file('a.pdf'), originalName: 'Facture.pdf', pages: [1, 4] }, true);
    expect(created).toMatchObject({ title: 'Facture.pdf', source_kind: 'pdf', status: 'queued', model_id: MODEL.id, task: 'default', pages: [1, 4] });
    await waitFor(settled(created.id));
    const detail = await service.detail(created.id);
    expect(detail).toMatchObject({ status: 'done', error: null, document_pages: 5, progress: { done: 2, total: 2 } });
    expect(detail.pages_read).toEqual([
      { index: 1, text: 'un', truncated: false, tokens: 3 },
      { index: 4, text: 'quatre', truncated: true, tokens: null },
    ]);
    expect(client.requests[0]).toMatchObject({ model_id: MODEL.id, task: 'default', pages: [1, 4], path: join(ocrDir(created.id), 'source.pdf') });
    expect(existsSync(join(ocrDir(created.id), 'source.pdf'))).toBe(true);
  });

  it('publishes the reading to the browser as it goes', async () => {
    const created = await service.create({ filePath: file('a.png'), originalName: 'scan.png' }, true);
    await waitFor(settled(created.id));
    const updates = s.published.filter((e) => e.topic === 'studio.ocr.updated').map((e) => e.data as { status: string; progress: { done: number } });
    expect(updates[0].status).toBe('queued');
    expect(updates.map((u) => u.status)).toEqual(expect.arrayContaining(['running', 'done']));
    expect(Math.max(...updates.map((u) => u.progress.done))).toBe(2);
  });

  it('ends as failed with the engine message and keeps the pages read before', async () => {
    client.script = [
      { type: 'pages', total: 2, document_pages: 2 },
      { type: 'page', index: 1, position: 1, total: 2, text: 'un', truncated: false },
      { type: 'error', code: 'upstream', message: 'boom' },
    ];
    const created = await service.create({ filePath: file('a.pdf'), originalName: 'a.pdf' }, true);
    await waitFor(settled(created.id));
    const detail = await service.detail(created.id);
    expect(detail).toMatchObject({ status: 'failed', error: 'boom' });
    expect(detail.pages_read).toHaveLength(1);
  });

  it('shows a refusal of the engine before the stream as the failure', async () => {
    client.refuse = new OcrEngineError(409, 'Le modèle n\'est pas téléchargé');
    const created = await service.create({ filePath: file('a.png'), originalName: 'a.png' }, true);
    await waitFor(settled(created.id));
    expect(await service.detail(created.id)).toMatchObject({ status: 'failed', error: "Le modèle n'est pas téléchargé" });
  });

  it('waits while the engine gauge is held, then reads', async () => {
    gate.tryAcquire('chat');
    const created = await service.create({ filePath: file('a.png'), originalName: 'a.png' }, true);
    await new Promise((r) => setTimeout(r, 60));
    expect((await service.detail(created.id)).status).toBe('queued');
    expect(client.requests).toHaveLength(0);
    gate.release('chat');
    await waitFor(settled(created.id));
    expect((await service.detail(created.id)).status).toBe('done');
    expect(gate.busy).toBe(false);
  });

  it('cancels a reading that is running and keeps its pages', async () => {
    let open!: () => void;
    client.hold = new Promise<void>((resolve) => { open = resolve; });
    const created = await service.create({ filePath: file('a.pdf'), originalName: 'a.pdf' }, true);
    await waitFor(async () => client.requests.length === 1);
    await service.cancel(created.id);
    await waitFor(settled(created.id));
    open();
    expect((await service.detail(created.id)).status).toBe('cancelled');
    expect(gate.busy).toBe(false);
  });

  it('cancels a reading that is still waiting', async () => {
    gate.tryAcquire('chat');
    const created = await service.create({ filePath: file('a.png'), originalName: 'a.png' }, true);
    expect(await service.cancel(created.id)).toMatchObject({ status: 'cancelled' });
    await expect(service.cancel(created.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('starts a reading again with another task, dropping its pages', async () => {
    const created = await service.create({ filePath: file('a.png'), originalName: 'a.png' }, true);
    await waitFor(settled(created.id));
    const again = await service.retry(created.id, { task: 'table', pages: [2] });
    expect(again).toMatchObject({ status: 'queued', task: 'table', pages: [2], progress: { done: 0, total: 0 } });
    await waitFor(settled(created.id));
    expect(client.requests[1]).toMatchObject({ task: 'table', pages: [2] });
  });

  it('deletes the reading, its pages and its files', async () => {
    const created = await service.create({ filePath: file('a.png'), originalName: 'a.png' }, true);
    await waitFor(settled(created.id));
    await service.remove(created.id);
    await expect(service.detail(created.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(existsSync(ocrDir(created.id))).toBe(false);
    expect(await dataSource.getRepository(OcrPageEntity).count()).toBe(0);
    expect(s.published.some((e) => e.topic === 'studio.ocr.deleted')).toBe(true);
  });

  it('searches the titles and the text of the pages', async () => {
    const a = await service.create({ filePath: file('a.png'), originalName: 'Facture EDF.png' }, true);
    await waitFor(settled(a.id));
    expect((await service.list('edf')).map((d) => d.id)).toEqual([a.id]);
    expect((await service.list('quatre')).map((d) => d.id)).toEqual([a.id]);
    expect(await service.list('introuvable')).toEqual([]);
  });

  it('exports the text of the pages', async () => {
    const created = await service.create({ filePath: file('a.pdf'), originalName: 'Facture 1.pdf' }, true);
    await waitFor(settled(created.id));
    expect(await service.exportFile(created.id, 'md')).toEqual({ body: '## Page 1\n\nun\n\n## Page 4\n\nquatre\n', mime: 'text/markdown; charset=utf-8', fileName: 'Facture 1.md' });
  });

  describe('refusals', () => {
    it('rejects a file that is neither an image nor a PDF, and leaves no row', async () => {
      await expect(service.create({ filePath: file('a.txt'), originalName: 'a.txt' }, true)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await service.list()).toEqual([]);
    });

    it('needs a model that is downloaded', async () => {
      models = [{ ...MODEL, ready: false }];
      await expect(service.create({ filePath: file('a.png'), originalName: 'a.png' }, true)).rejects.toThrow(/GLM-OCR/);
      models = [];
      await expect(service.create({ filePath: file('b.png'), originalName: 'b.png' }, true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('checks the task against what the model offers', async () => {
      const make = (task: never, prompt?: string, modelId?: string) => service.create({ filePath: file('a.png'), originalName: 'a.png', task, prompt, modelId }, true);
      await expect(make('formula' as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(make('custom' as never, 'lis')).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(make('custom' as never, '  ', FREE_MODEL.id)).rejects.toBeInstanceOf(UnprocessableEntityException);
      const created = await make('custom' as never, 'liste les montants', FREE_MODEL.id);
      expect(created).toMatchObject({ task: 'custom', prompt: 'liste les montants' });
      await waitFor(settled(created.id));
    });
  });

  it('resumes the waiting readings at startup and fails the one that was running', async () => {
    const store = new OcrStoreService(dataSource.getRepository(OcrDocumentEntity), dataSource.getRepository(OcrPageEntity));
    const row = (id: string, status: 'queued' | 'running') => store.insert(Object.assign(new OcrDocumentEntity(), {
      id, title: id, sourceFile: 'source.png', sourceKind: 'image', documentPages: 1, pages: null, modelId: MODEL.id, modelName: 'M', task: 'default',
      prompt: null, status, error: null, pagesDone: 0, pagesTotal: 0, createdAt: 1, updatedAt: 1,
    }));
    await row('was-running', 'running');
    await row('was-waiting', 'queued');
    await service.onApplicationBootstrap();
    expect(await service.detail('was-running')).toMatchObject({ status: 'failed' });
    await waitFor(settled('was-waiting'));
    expect(client.requests.map((r) => r.path)).toEqual([join(ocrDir('was-waiting'), 'source.png')]);
  });
});
