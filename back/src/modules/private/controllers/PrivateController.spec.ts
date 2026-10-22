/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildPrivate, type PrivateHarness } from '../testing/privateHarness';
import { PrivateEvents } from '../services/PrivateEvents';
import { PrivateGenerationService } from '../services/PrivateGenerationService';
import { PrivateSessionService } from '../services/PrivateSessionService';
import { PrivateStore } from '../services/PrivateStore';
import { PrivateUploadService } from '../services/PrivateUploadService';
import { PrivateController } from './PrivateController';
import { NoStoreInterceptor } from './NoStoreInterceptor';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('/api/private/*', () => {
  let dataSource: DataSource;
  let p: PrivateHarness;
  let app: INestApplication;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    p = buildPrivate(dataSource);
    p.engine.on('POST /engine/v1/media/ingest', (call) => {
      const body = call.options?.body as { asset_id: string; private_dir: string; source_path: string };
      unlinkSync(body.source_path); // the engine consumes the raw upload
      writeFileSync(join(body.private_dir, 'inputs', `${body.asset_id}.png`), PNG);
      return { media: 'image', filename: `${body.asset_id}.png`, thumb: `${body.asset_id}.webp`, width: 1, height: 1, meta: {} };
    });
    @Module({
      controllers: [PrivateController],
      providers: [
        NoStoreInterceptor,
        { provide: PrivateSessionService, useValue: p.session },
        { provide: PrivateStore, useValue: p.store },
        { provide: PrivateGenerationService, useValue: p.generations },
        { provide: PrivateUploadService, useValue: p.uploads },
        { provide: PrivateEvents, useValue: p.events },
        { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await p.session.end();
    await app.close();
    await dataSource.destroy();
  });
  beforeEach(() => p.session.onModuleInit());
  afterEach(async () => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    await p.session.end();
  });

  const http = () => request(app.getHttpServer());

  it('the session starts, reports itself, and ends on request or on the browser\'s last word; answers are never cacheable', async () => {
    expect((await http().get('/api/private/session').expect(200)).body).toMatchObject({ active: false });
    const started = await http().post('/api/private/session').expect(200);
    expect(started.body).toMatchObject({ active: true, conversations: 0, results: 0 });
    expect(started.headers['cache-control']).toContain('no-store');
    expect(existsSync(p.session.dir)).toBe(true);
    await http().post('/api/private/session/leave').expect(204);
    expect(p.session.active).toBe(false);
    await http().post('/api/private/session').expect(200);
    const dir = p.session.dir;
    expect((await http().delete('/api/private/session').expect(200)).body).toMatchObject({ active: false });
    expect(existsSync(dir)).toBe(false);
  });

  it('without a session every studio route answers 409 and nothing is stored', async () => {
    await http().get('/api/private/conversations').expect(409);
    await http().post('/api/private/conversations').send({}).expect(409);
    await http().post('/api/private/messages').send({ prompt: 'p', model_id: 'demo' }).expect(409);
    await http().get('/api/private/conversations/x').expect(409);
    expect(p.store.counts()).toEqual({ conversations: 0, results: 0 });
  });

  it('conversations: created, listed, renamed, pinned, deleted', async () => {
    await http().post('/api/private/session').expect(200);
    const created = (await http().post('/api/private/conversations').send({ mode: 'video' }).expect(200)).body;
    expect(created).toMatchObject({ mode: 'video', title: 'Création privée', messages: [] });
    await http().post('/api/private/conversations').send({ mode: 'musique' }).expect(422);
    await http().post('/api/private/conversations').send({ title: 5 }).expect(422);
    const patched = await http().patch(`/api/private/conversations/${created.id}`).send({ title: '  Mon titre  ', pinned: true }).expect(200);
    expect(patched.body).toMatchObject({ title: 'Mon titre', pinned: true });
    await http().patch(`/api/private/conversations/${created.id}`).send({ pinned: 'oui' }).expect(422);
    expect((await http().get('/api/private/conversations?mode=video').expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/private/conversations?q=titre').expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/private/conversations?mode=image').expect(200)).body).toHaveLength(0);
    expect((await http().get('/api/private/conversations?mode=chat').expect(200)).body).toEqual([]);
    await http().delete(`/api/private/conversations/${created.id}`).expect(200);
    await http().get(`/api/private/conversations/${created.id}`).expect(404);
  });

  it('a chat conversation is a shell: a generic title and a message count, never what was said', async () => {
    await http().post('/api/private/session').expect(200);
    const chat = (await http().post('/api/private/conversations').send({ mode: 'chat' }).expect(200)).body;
    expect(chat).toMatchObject({ mode: 'chat', title: 'Conversation privée', generation_count: 0, cover: null, messages: [] });
    await http().patch(`/api/private/conversations/${chat.id}`).send({ message_count: 4 }).expect(200);
    const listed = (await http().get('/api/private/conversations?mode=chat').expect(200)).body;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: chat.id, generation_count: 4, mode: 'chat' });
    for (const bad of [-1, 1.5, '3', 100_001]) await http().patch(`/api/private/conversations/${chat.id}`).send({ message_count: bad }).expect(422);
    expect((await http().get('/api/private/conversations?mode=image').expect(200)).body).toEqual([]);
    await http().delete(`/api/private/conversations/${chat.id}`).expect(200);
  });

  it('a generation is created, shows in the queue, can be cancelled, and is validated like a normal one', async () => {
    await http().post('/api/private/session').expect(200);
    await http().post('/api/private/messages').send({ prompt: '', model_id: 'demo' }).expect(422);
    await http().post('/api/private/messages').send({ prompt: 'p' }).expect(422);
    const created = (await http().post('/api/private/messages').send({ prompt: 'un chat', model_id: 'demo' }).expect(200)).body;
    expect(created).toMatchObject({ user_message: { role: 'user', prompt: 'un chat' }, assistant_message: { role: 'assistant', status: 'queued' } });
    await p.generations.idle();
    expect((await http().get('/api/private/queue').expect(200)).body).toEqual({ current: created.assistant_message.id, queue: [] });
    await http().post(`/api/private/messages/${created.assistant_message.id}/cancel`).expect(200);
    p.emit('job.cancelled', { job_id: created.assistant_message.id, outputs: 0 });
    await p.generations.idle();
    await http().post(`/api/private/messages/${created.assistant_message.id}/cancel`).expect(409);
    await http().delete(`/api/private/messages/${created.assistant_message.id}`).expect(200);
    await http().delete('/api/private/messages/ghost').expect(404);
  });

  it('a reference goes to the session folder, never to uploads/, and no raw file is left behind', async () => {
    await http().post('/api/private/session').expect(200);
    const res = await http().post('/api/private/assets').attach('files', PNG, 'ma-photo.png').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ kind: 'upload', media: 'image', original_name: 'ma-photo.png' });
    expect(res.body[0].url).toBe(`/media/private/${p.session.sessionId}/inputs/${res.body[0].id}.png`);
    expect(readdirSync(join(p.session.dir, 'tmp'))).toEqual([]);
    expect(Object.values(p.listing()).flat()).toEqual([]);
    expect(existsSync(join(p.session.dir, 'inputs', `${res.body[0].id}.png`))).toBe(true);
    await http().patch(`/api/private/assets/${res.body[0].id}`).send({ favorite: true }).expect(200);
    await http().delete(`/api/private/assets/${res.body[0].id}`).expect(200);
    expect(existsSync(join(p.session.dir, 'inputs', `${res.body[0].id}.png`))).toBe(false);
    await http().post('/api/private/assets').expect(422);
  });

  it('an upload without a session is refused and leaves nothing', async () => {
    await http().post('/api/private/assets').attach('files', PNG, 'x.png').expect(409);
    expect(Object.values(p.listing()).flat()).toEqual([]);
  });

  it('the routes are for the administrator only', async () => {
    principal = undefined;
    const res = await http().get('/api/private/session');
    expect([401, 403]).toContain(res.status);
  });
});
