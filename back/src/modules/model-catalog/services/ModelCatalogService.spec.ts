/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
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

  it('frees the full-precision source of a model', async () => {
    answer(200, { freed_gb: 58.0 });
    await request(app.getHttpServer()).delete('/api/models/m/source/bf16').expect(200, { freed_gb: 58.0 });
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/models/m/source/bf16' });
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

  it('searches the language models of Hugging Face and refuses an unknown kind before it reaches the engine', async () => {
    answer(200, { results: [{ repo: 'org/m-GGUF', family: 'llm-gguf', task: 'llm' }] });
    const res = await request(app.getHttpServer()).get('/api/hf/search?kind=llm&q=qwen').expect(200);
    expect(res.body.results[0]).toMatchObject({ family: 'llm-gguf', task: 'llm' });
    expect(last().url).toBe('/engine/v1/hf/search?kind=llm&q=qwen');
    const before = engine.requests.length;
    for (const kind of ['chat', 'LLM', '..%2Fadmin', 'image%26x%3D1']) await request(app.getHttpServer()).get(`/api/hf/search?kind=${kind}&q=x`).expect(400);
    expect(engine.requests).toHaveLength(before);
  });

  it('lets the language models and the chat summary of the catalogue through untouched', async () => {
    const catalog = {
      models: [{ id: 'llm-a', kind: 'llm', backend: 'llamacpp', llm: { context_default: 16384, context_max: 32768, vision: false, tools: true, reasoning: 'toggle', moe: false, params_b: 4, active_params_b: null } }],
      default_model_id: null, recommended_model_id: null, ready: false,
      audio: { default_model_id: null, recommended_model_id: null, ready: false }, video: { default_model_id: null, recommended_model_id: null, ready: false },
      llm: { default_model_id: 'llm-a', recommended_model_id: 'llm-a', ready: true },
    };
    answer(200, catalog);
    const res = await request(app.getHttpServer()).get('/api/models').expect(200);
    expect(res.body).toEqual(catalog);
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

  describe('what is new on Hugging Face', () => {
    const body = { kind: 'llm', days: 90, generated_at: 1, cached: false, results: [], hidden: { heavy: 0, existing: 0 } };

    it('relays the answer with the defaults, and the validated parameters', async () => {
      answer(200, body);
      await request(app.getHttpServer()).get('/api/hf/trending').expect(200, body);
      expect(last().url).toBe('/engine/v1/hf/trending?kind=image&days=90&limit=12&include_heavy=false&refresh=false');
      await request(app.getHttpServer()).get('/api/hf/trending?kind=llm&days=30&limit=5&include_heavy=true&refresh=true').expect(200);
      expect(last().url).toBe('/engine/v1/hf/trending?kind=llm&days=30&limit=5&include_heavy=true&refresh=true');
    });

    it.each([
      ['kind=music'], ['kind=image;drop'], ['days=6'], ['days=366'], ['days=abc'], ['days=30.5'], ['limit=0'], ['limit=31'],
      ['include_heavy=1'], ['refresh=yes'], ['days=1&days=2'],
    ])('refuses %s before it reaches the engine', async (query) => {
      await request(app.getHttpServer()).get(`/api/hf/trending?${query}`).expect(400);
      expect(engine.requests).toHaveLength(0);
    });

    it('needs an administrator, relays the engine refusal and the unreachable Hub', async () => {
      principal = undefined;
      await request(app.getHttpServer()).get('/api/hf/trending').expect(401);
      principal = { id: 0, admin: true, kind: 'local-trust' };
      answer(502, { detail: 'Hugging Face est injoignable.' });
      const res = await request(app.getHttpServer()).get('/api/hf/trending?kind=audio').expect(502);
      expect(res.body.message).toBe('Hugging Face est injoignable.');
    });
  });

  it('answers 502 when the engine is unreachable', async () => {
    const down = new ModelCatalogService(new EngineClient(testConfig('http://127.0.0.1:1')));
    await expect(down.catalog()).rejects.toMatchObject({ status: 502 });
  });
});
