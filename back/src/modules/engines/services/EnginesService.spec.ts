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
import { EnginesController } from '../controllers/EnginesController';
import { EnginesService } from './EnginesService';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

describe('engines routes (fake engine)', () => {
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
      controllers: [EnginesController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        EngineClient,
        EnginesService,
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
    await request(app.getHttpServer()).post('/api/engines/sdcpp/install').expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  it('installs a pack (200, the state) and relays a 404 for an unknown pack', async () => {
    answer(200, { state: 'running', pack: 'audio-tts' });
    await request(app.getHttpServer()).post('/api/engines/pack/audio-tts/install').expect(200, { state: 'running', pack: 'audio-tts' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/engines/pack/audio-tts/install' });
    answer(404, { detail: 'Pack inconnu' });
    await request(app.getHttpServer()).post('/api/engines/pack/nope/install').expect(404);
  });

  it('cancels the pack installation before treating "install" as a pack id', async () => {
    answer(200, { ok: true });
    await request(app.getHttpServer()).delete('/api/engines/pack/install').expect(200, { ok: true });
    expect(last().url).toBe('/engine/v1/engines/pack/install');
    await request(app.getHttpServer()).delete('/api/engines/pack/audio-tts').expect(200);
    expect(last().url).toBe('/engine/v1/engines/pack/audio-tts');
  });

  it('relays the engine refusal when nothing is installing', async () => {
    answer(409, { detail: 'Aucune installation en cours.' });
    const res = await request(app.getHttpServer()).delete('/api/engines/sdcpp/install').expect(409);
    expect(res.body.message).toBe('Aucune installation en cours.');
  });

  it('installs stable-diffusion.cpp', async () => {
    answer(200, { state: 'running', variant: 'metal' });
    await request(app.getHttpServer()).post('/api/engines/sdcpp/install').expect(200, { state: 'running', variant: 'metal' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/engines/sdcpp/install' });
  });

  it('installs, cancels and removes llama.cpp (the chat runtime), and relays its refusals', async () => {
    answer(200, { state: 'running', variant: 'metal' });
    await request(app.getHttpServer()).post('/api/engines/llamacpp/install').expect(200, { state: 'running', variant: 'metal' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/engines/llamacpp/install' });
    answer(200, { ok: true });
    await request(app.getHttpServer()).delete('/api/engines/llamacpp/install').expect(200, { ok: true });
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/engines/llamacpp/install' }); // "install" is not an engine path
    await request(app.getHttpServer()).delete('/api/engines/llamacpp').expect(200, { ok: true });
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/engines/llamacpp' });
    answer(409, { detail: "Le moteur de chat est en cours d'utilisation : déchargez le modèle d'abord." });
    const refused = await request(app.getHttpServer()).delete('/api/engines/llamacpp').expect(409);
    expect(refused.body.message).toMatch(/déchargez le modèle/);
  });

  it('lists the components (asking for the disk usage only on request) and removes one', async () => {
    answer(200, { components: [{ id: 'ffmpeg', kind: 'base', installed: true }] });
    await request(app.getHttpServer()).get('/api/engines/components').expect(200, [{ id: 'ffmpeg', kind: 'base', installed: true }]);
    expect(last()).toMatchObject({ method: 'GET', url: '/engine/v1/components?disk=false' });
    await request(app.getHttpServer()).get('/api/engines/components?disk=true').expect(200);
    expect(last().url).toBe('/engine/v1/components?disk=true');
    answer(200, { ok: true, removed_models: [{ id: 'm1', name: 'M1', kind: 'video' }] });
    const res = await request(app.getHttpServer()).delete('/api/engines/components/ffmpeg').expect(200);
    expect(res.body.removed_models).toHaveLength(1);
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/components/ffmpeg' });
    answer(409, { detail: "Ce moteur est en cours d'utilisation : déchargez le modèle d'abord." });
    await request(app.getHttpServer()).delete('/api/engines/components/sdcpp').expect(409);
  });

  it('plans, starts and cancels the setup of a model, and reads the current run', async () => {
    answer(200, { model_id: 'wan', steps: [], ready: true, total_mb: 0, blocked: null });
    await request(app.getHttpServer()).get('/api/engines/setup/plan/wan').expect(200);
    expect(last()).toMatchObject({ method: 'GET', url: '/engine/v1/models/wan/setup-plan' });
    answer(200, { state: 'running', model_id: 'wan' });
    await request(app.getHttpServer()).post('/api/engines/setup/wan').expect(200, { state: 'running', model_id: 'wan' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/setup/wan' });
    await request(app.getHttpServer()).get('/api/engines/setup').expect(200);
    expect(last()).toMatchObject({ method: 'GET', url: '/engine/v1/setup' });
    answer(200, { ok: true });
    await request(app.getHttpServer()).delete('/api/engines/setup').expect(200, { ok: true });
    expect(last()).toMatchObject({ method: 'DELETE', url: '/engine/v1/setup' });
    answer(409, { detail: 'Une autre installation est déjà en cours.' });
    await request(app.getHttpServer()).post('/api/engines/setup/other').expect(409);
  });

  it('answers 502 when the engine is unreachable', async () => {
    const down = new EnginesService(new EngineClient(testConfig('http://127.0.0.1:1')));
    await expect(down.installSdcpp()).rejects.toMatchObject({ status: 502 });
  });
});
