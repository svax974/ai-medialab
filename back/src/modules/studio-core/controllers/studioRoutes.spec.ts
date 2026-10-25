/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AssetController, AssetExportService, AssetFileService, AssetService, AssetShareService, StudioEvents } from 'src/modules/media-library';
import { EngineClient } from 'src/modules/engine';
import { ENGINE_CONFIG } from 'src/modules/engine/engineConfig';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { LegacyImportService } from 'src/modules/legacy-import/services/LegacyImportService';
import { buildLegacyDatabase, loadExpectedPublic } from 'src/modules/legacy-import/testing/legacyDatabase';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { ConversationController } from './ConversationController';
import { MessageController } from './MessageController';
import { ConversationService } from '../services/ConversationService';
import { GenerationService } from '../services/GenerationService';
import { MessageService } from '../services/MessageService';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

/**
 * The routes `/api/conversations*`, `/api/messages*` and `/api/assets*` over a database imported from the legacy demo
 * rows: the answers must equal what the engine's legacy routes produced (outputs captured in `expectedPublic.json`).
 */
describe('studio routes: public forms identical to the legacy engine', () => {
  const expected = loadExpectedPublic();
  let dataSource: DataSource;
  let studio: Studio;
  let engine: FakeEngine;
  let app: INestApplication;
  let cleanup: () => void;
  const dataDir = mkdtempSync(join(tmpdir(), 'studio-routes-'));

  beforeAll(async () => {
    process.env.APP_DATA_DIR = dataDir;
    engine = await startFakeEngine();
    engine.handle((req, res) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/engine/v1/jobs/check') return json(200, { kind: 'image', name: 'Démo', max_count: 4, default_params: { steps: 12 } });
      if (req.url === '/engine/v1/jobs') return json(202, { job_id: 'x', state: 'queued', outputs: [] });
      if (req.url === '/engine/v1/media/ingest') {
        const body = JSON.parse(req.body.toString()) as { asset_id: string };
        return json(200, { media: 'image', filename: `${body.asset_id}.png`, thumb: `${body.asset_id}.webp`, width: 30, height: 20, meta: {} });
      }
      return json(200, { ok: true, deleted: 0 });
    });
    dataSource = await createTestDataSource();
    const built = buildLegacyDatabase();
    cleanup = built.cleanup;
    const moduleConfig = { getSchema: () => ({}), register: () => undefined, updateModuleConfig: async () => null };
    await new LegacyImportService(dataSource, moduleConfig as never).run(built.dir);
    studio = buildStudio(dataSource, new EngineClient(testConfig(engine.url)));

    @Module({
      controllers: [ConversationController, MessageController, AssetController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        { provide: ConversationService, useValue: studio.conversations },
        { provide: GenerationService, useValue: studio.generations },
        { provide: MessageService, useValue: studio.messages },
        { provide: AssetService, useValue: studio.assets },
        { provide: AssetFileService, useValue: studio.files },
        { provide: AssetExportService, useValue: {} },
        { provide: AssetShareService, useValue: {} },
        { provide: StudioEvents, useValue: studio.events },
        { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await engine.close();
    await dataSource.destroy();
    cleanup();
  });
  afterEach(() => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    studio.published.length = 0;
  });

  const http = () => request(app.getHttpServer());

  it('GET /api/conversations: same list, same order, same filters', async () => {
    expect((await http().get('/api/conversations').expect(200)).body).toEqual(expected.conversationList);
    expect((await http().get('/api/conversations?mode=audio').expect(200)).body).toEqual(expected.conversationListAudio);
    expect((await http().get('/api/conversations?q=plage').expect(200)).body).toEqual(expected.conversationListQuery);
    expect((await http().get('/api/conversations?mode=bogus').expect(200)).body).toEqual(expected.conversationList);
  });

  it('GET /api/conversations/:id: same detail; 404 for an unknown one', async () => {
    for (const [id, conversation] of Object.entries(expected.conversations)) {
      expect((await http().get(`/api/conversations/${id}`).expect(200)).body).toEqual(conversation);
    }
    const missing = await http().get('/api/conversations/ghost').expect(404);
    expect(missing.body).toMatchObject({ statusCode: 404, message: 'Conversation introuvable.' });
  });

  it('GET /api/assets: same gallery pages and cursor form', async () => {
    const page = (await http().get('/api/assets').expect(200)).body;
    expect(Object.keys(page).sort()).toEqual(['items', 'next_before']);
    expect(page.items).toEqual(expected.gallery.generatedImage);
    expect((await http().get('/api/assets?media=audio').expect(200)).body.items).toEqual(expected.gallery.generatedAudio);
    expect((await http().get('/api/assets?kind=upload').expect(200)).body.items).toEqual(expected.gallery.uploadImage);
    expect((await http().get('/api/assets?limit=1').expect(200)).body.next_before).toEqual(page.items[0].created_at);
  });

  it('conversation routes: create, patch, delete answer with the legacy bodies and publish the legacy events', async () => {
    const created = await http().post('/api/conversations').send({ title: ' Test ', mode: 'audio' }).expect(200);
    expect(created.body).toMatchObject({ title: 'Test', mode: 'audio', pinned: false, cover: null, generation_count: 0, busy: false, messages: [] });
    expect(Object.keys(created.body).sort()).toEqual(Object.keys(expected.conversations.c1).sort());
    const id = created.body.id as string;
    const patched = await http().patch(`/api/conversations/${id}`).send({ title: 'Nouveau', pinned: true }).expect(200);
    expect(patched.body).toMatchObject({ title: 'Nouveau', pinned: true });
    expect(patched.body.messages).toBeUndefined();
    expect(await http().patch('/api/conversations/ghost').send({ pinned: true }).expect(404)).toBeDefined();
    await http().patch(`/api/conversations/${id}`).send({ pinned: 'yes' }).expect(422);
    expect((await http().delete(`/api/conversations/${id}`).expect(200)).body).toEqual({ ok: true });
    expect(studio.published.map((e) => `${e.topic}|${e.type}`)).toEqual([
      'studio.conversation.updated|conversation.updated', 'studio.conversation.updated|conversation.updated',
      'studio.conversation.deleted|conversation.deleted',
    ]);
  });

  it('GET /api/messages/model-usage: finished generations per model', async () => {
    const { counts } = (await http().get('/api/messages/model-usage').expect(200)).body as { counts: Record<string, number> };
    expect(Object.keys(counts).length).toBeGreaterThan(0);
    expect(Object.values(counts).every((n) => Number.isInteger(n) && n > 0)).toBe(true);
  });

  it('message routes: create answers with the three legacy members, in the legacy message form', async () => {
    const created = (await http().post('/api/messages').send({ prompt: 'Un chat', model_id: 'demo', count: 2 }).expect(200)).body;
    expect(Object.keys(created).sort()).toEqual(['assistant_message', 'conversation_id', 'user_message']);
    expect(Object.keys(created.assistant_message).sort()).toEqual(Object.keys(expected.messages.m1).sort());
    expect(Object.keys(created.user_message).sort()).toEqual(Object.keys(expected.messages.m1).sort());
    expect(created.assistant_message).toMatchObject({ status: 'queued', role: 'assistant', model_id: 'demo', outputs: [], references: [] });
    expect(studio.published.map((e) => e.type)).toEqual(['conversation.updated']);

    await http().post('/api/messages').send({ prompt: '', model_id: 'demo' }).expect(422);
    await http().post('/api/messages').send({ prompt: 'x' }).expect(422);
    await http().post('/api/messages').send({ prompt: 'x', model_id: 'demo', conversation_id: 'ghost' }).expect(404);
    const retried = (await http().post(`/api/messages/${created.assistant_message.id}/retry`).send({}).expect(200)).body;
    expect(Object.keys(retried).sort()).toEqual(Object.keys(expected.messages.m1).sort());
    await http().post(`/api/messages/${created.user_message.id}/retry`).expect(404);
    await http().post('/api/messages/ghost/cancel').expect(409);
    const cancelled = await http().post(`/api/messages/${retried.id}/cancel`).expect(200);
    expect(cancelled.body).toEqual({ ok: true });
    const deleted = await http().delete(`/api/messages/${created.user_message.id}`).expect(200);
    expect(deleted.body.ok).toBe(true);
    expect(deleted.body.deleted).toContain(created.assistant_message.id);
    await http().delete('/api/messages/ghost').expect(404);
  });

  it('asset routes: favourite and delete publish the legacy events; unknown ids are 404', async () => {
    const asset = (await http().patch('/api/assets/g2').send({ favorite: true }).expect(200)).body;
    expect(asset).toEqual({ ...expected.assets.g2, favorite: true });
    await http().patch('/api/assets/g2').send({ favorite: 'oui' }).expect(422);
    await http().patch('/api/assets/ghost').send({ favorite: true }).expect(404);
    expect((await http().delete('/api/assets/g2').expect(200)).body).toEqual({ ok: true });
    await http().delete('/api/assets/g2').expect(404);
    expect(studio.published.map((e) => e.type)).toEqual(['asset.updated', 'asset.deleted']);
    expect(studio.published[1].data).toEqual({ id: 'g2', message_id: 'm1', conversation_id: 'c1' });
  });

  it('POST /api/assets: the engine ingests the file, Nest stores the row and answers the legacy list', async () => {
    const res = await http().post('/api/assets').attach('files', Buffer.from('fake png bytes'), 'été.png').expect(200);
    expect(res.body).toHaveLength(1);
    const [asset] = res.body;
    expect(asset).toMatchObject({
      kind: 'upload', media: 'image', original_name: 'été.png', width: 30, height: 20, favorite: false,
      url: `/media/uploads/${asset.id}.png`, thumb_url: `/media/thumbs/${asset.id}.webp`, conversation_id: null,
    });
    expect(Object.keys(asset).sort()).toEqual(Object.keys(expected.assets.a_free).sort());
    const ingest = JSON.parse(engine.requests.filter((r) => r.url === '/engine/v1/media/ingest').at(-1)!.body.toString());
    expect(ingest).toMatchObject({ asset_id: asset.id, original_name: 'été.png' });
    expect(ingest.source_path.startsWith(join(dataDir, 'uploads', 'tmp_'))).toBe(true);
    expect(existsSync(ingest.source_path)).toBe(true); // the engine consumes it; the fake does not
    expect(readFileSync(ingest.source_path, 'utf8')).toBe('fake png bytes');
    expect((await studio.assets.get(asset.id))?.original_name).toBe('été.png');
    await http().post('/api/assets').expect(422);
  });

  it('every route needs an administrator', async () => {
    principal = undefined;
    for (const [method, url] of [['get', '/api/conversations'], ['post', '/api/messages'], ['get', '/api/assets'], ['delete', '/api/assets/x']] as const) {
      expect([401, 403]).toContain((await http()[method](url)).status);
    }
    principal = { id: 5, admin: false, kind: 'user' } as AuthPrincipal;
    expect([401, 403]).toContain((await http().get('/api/conversations')).status);
  });
});
