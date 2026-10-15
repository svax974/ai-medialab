/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ConversationController, ConversationService, GenerationService } from 'src/modules/studio-core';
import { StudioEvents } from 'src/modules/media-library';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';

@Injectable()
class LocalTrust implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), { id: 0, admin: true, kind: 'local-trust' });
    return next.handle();
  }
}

/** The shared conversation routes know the chat mode: the sidebar lists, creates, renames and pins chat conversations like the others. */
describe('/api/conversations with mode=chat', () => {
  let dataSource: DataSource;
  let studio: Studio;
  let app: INestApplication;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    studio = buildStudio(dataSource);
    @Module({
      controllers: [ConversationController],
      providers: [
        { provide: ConversationService, useValue: studio.conversations },
        { provide: GenerationService, useValue: studio.generations },
        { provide: StudioEvents, useValue: studio.events },
        { provide: APP_INTERCEPTOR, useClass: LocalTrust },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
  });

  it('creates a chat conversation with its own default title, lists it by mode, renames and pins it', async () => {
    const http = () => request(app.getHttpServer());
    const created = (await http().post('/api/conversations').send({ mode: 'chat' }).expect(200)).body;
    expect(created).toMatchObject({ mode: 'chat', title: 'Nouvelle conversation', messages: [], generation_count: 0, cover: null });
    const image = (await http().post('/api/conversations').send({}).expect(200)).body;
    expect(image).toMatchObject({ mode: 'image', title: 'Nouvelle création' });
    expect((await http().get('/api/conversations?mode=chat').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([created.id]);
    expect((await http().get('/api/conversations?mode=image').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([image.id]);
    const patched = (await http().patch(`/api/conversations/${created.id}`).send({ title: 'Mes idées', pinned: true }).expect(200)).body;
    expect(patched).toMatchObject({ title: 'Mes idées', pinned: true, mode: 'chat' });
    expect((await http().get('/api/conversations?mode=bogus').expect(200)).body).toHaveLength(2); // an unknown mode is no filter, as before
    expect((await http().delete(`/api/conversations/${created.id}`).expect(200)).body).toEqual({ ok: true });
  });
});
