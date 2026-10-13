/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { ENGINE_CONFIG } from 'src/modules/engine/engineConfig';
import { EngineClient } from 'src/modules/engine';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { ModelCatalogController } from '../controllers/ModelCatalogController';
import { ModelCatalogService } from './ModelCatalogService';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

describe('model-catalog routes (fake engine)', () => {
  let engine: FakeEngine;
  let app: INestApplication;

  const answer = (status: number, body: unknown) =>
    engine.handle((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  const last = () => engine.requests[engine.requests.length - 1];

  beforeAll(async () => {
    engine = await startFakeEngine();
    @Module({
      controllers: [ModelCatalogController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        EngineClient,
        ModelCatalogService,
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
  });
  afterEach(() => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    engine.requests.length = 0;
  });

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await request(app.getHttpServer()).get('/api/models').expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  it('relays the catalogue unchanged', async () => {
    const catalog = { models: [{ id: 'm' }], default_model_id: 'm', audio: {}, video: {} };
    answer(200, catalog);
    const res = await request(app.getHttpServer()).get('/api/models').expect(200);
    expect(res.body).toEqual(catalog);
    expect(last()).toMatchObject({ method: 'GET', url: '/engine/v1/models' });
    expect(last().headers['x-engine-token']).toBeDefined();
  });

  it('starts a download (200, the job) and cancels it', async () => {
    answer(200, { model_id: 'a b', state: 'running', done: 0, total: 10 });
    const res = await request(app.getHttpServer()).post('/api/models/a%20b/download').expect(200);
    expect(res.body.state).toBe('running');
    expect(last().url).toBe('/engine/v1/models/a%20b/download');
    answer(200, { ok: true });
    await request(app.getHttpServer()).delete('/api/models/m/download').expect(200, { ok: true });
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/models/m/download' });
  });

  it('relays the engine refusal status and message', async () => {
    answer(409, { detail: 'Aucun téléchargement en cours pour ce modèle.' });
    const res = await request(app.getHttpServer()).delete('/api/models/m/download').expect(409);
    expect(res.body.message).toBe('Aucun téléchargement en cours pour ce modèle.');
  });

  it('deletes a model, and a custom model through the longer path', async () => {
    answer(200, { freed_gb: 3.2, also_affects: [] });
    await request(app.getHttpServer()).delete('/api/models/m').expect(200, { freed_gb: 3.2, also_affects: [] });
    expect(last().url).toBe('/engine/v1/models/m');
    await request(app.getHttpServer()).delete('/api/models/m/custom').expect(200);
    expect(last().url).toBe('/engine/v1/models/m/custom');
  });

  it('adds a custom model (not read as a model id) with the default option', async () => {
    answer(200, { model_id: 'custom-1' });
    const res = await request(app.getHttpServer()).post('/api/models/custom').send({ repo: ' org/name ' }).expect(200);
    expect(res.body).toEqual({ model_id: 'custom-1' });
    expect(last().url).toBe('/engine/v1/models/custom');
    expect(JSON.parse(last().body.toString())).toEqual({ repo: 'org/name', option: 'default' });
  });

  it('rejects a custom model without a repository', async () => {
    await request(app.getHttpServer()).post('/api/models/custom').send({}).expect(400);
    expect(engine.requests).toHaveLength(0);
  });

  it('searches and inspects Hugging Face', async () => {
    answer(200, { results: [] });
    await request(app.getHttpServer()).get('/api/hf/search?kind=video&q=wan').expect(200, { results: [] });
    expect(last().url).toBe('/engine/v1/hf/search?kind=video&q=wan');
    await request(app.getHttpServer()).get('/api/hf/search').expect(200);
    expect(last().url).toBe('/engine/v1/hf/search?kind=image&q=');
    answer(422, { detail: 'Dépôt introuvable.' });
    const res = await request(app.getHttpServer()).get('/api/hf/inspect?repo=a%2Fb').expect(422);
    expect(res.body.message).toBe('Dépôt introuvable.');
    expect(last().url).toBe('/engine/v1/hf/inspect?repo=a%2Fb');
    await request(app.getHttpServer()).get('/api/hf/inspect').expect(400);
  });

  it('answers 502 when the engine is unreachable', async () => {
    const down = new ModelCatalogService(new EngineClient(testConfig('http://127.0.0.1:1')));
    await expect(down.catalog()).rejects.toMatchObject({ status: 502 });
  });
});
