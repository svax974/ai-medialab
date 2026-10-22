/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
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
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { createTestDataSource } from 'src/testing/testDataSource';
import type { DataSource } from 'typeorm';
import { UpdatesController } from '../controllers/UpdatesController';
import { UpdateAdvisoryEntity } from '../entities/UpdateAdvisoryEntity';
import { UpdateAdvisoryService } from './UpdateAdvisoryService';
import { UpdatesService } from './UpdatesService';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

describe('updates routes (fake engine)', () => {
  let engine: FakeEngine;
  let app: INestApplication;
  let dataSource: DataSource;
  let gate: EngineBusyGate;
  const queue = { occupied: false };

  const answer = (status: number, body: unknown) =>
    engine.handle((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  const last = () => engine.requests[engine.requests.length - 1];

  beforeAll(async () => {
    engine = await startFakeEngine();
    dataSource = await createTestDataSource();
    gate = new EngineBusyGate();
    @Module({
      controllers: [UpdatesController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        EngineClient,
        { provide: UpdateAdvisoryService, useValue: new UpdateAdvisoryService(dataSource.getRepository(UpdateAdvisoryEntity)) },
        { provide: EngineBusyGate, useValue: gate },
        { provide: GenerationQueueService, useValue: queue },
        UpdatesService,
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
  });
  afterEach(async () => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    engine.requests.length = 0;
    queue.occupied = false;
    if (gate.busy) gate.release(gate.heldBy as string);
    await dataSource.getRepository(UpdateAdvisoryEntity).clear();
  });

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await request(app.getHttpServer()).get('/api/updates/check').expect(401);
    await request(app.getHttpServer()).post('/api/updates/models/z-image-turbo').expect(401);
    await request(app.getHttpServer()).get('/api/updates/advisories').expect(401);
    await request(app.getHttpServer()).post('/api/updates/advise').send({ kind: 'engine', id: 'sdcpp' }).expect(401);
    await request(app.getHttpServer()).delete('/api/updates/advisories/x').expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  it('relays the report of the check', async () => {
    const report = { engines: [{ id: 'sdcpp', state: 'update', target: 'master-956', latest: null }], models: [{ id: 'm', state: 'current' }], checked_at: 1 };
    answer(200, report);
    const res = await request(app.getHttpServer()).get('/api/updates/check').expect(200);
    expect(res.body).toMatchObject({ engines: [{ id: 'sdcpp', state: 'update', advice: null, latest: null }], models: [{ id: 'm', state: 'current', advice: null }], checked_at: 1 });
    expect(last()).toMatchObject({ method: 'GET', url: '/engine/v1/updates/check' });
  });

  it('starts the update of a model and of an engine (200, the installer state), the id encoded in the path', async () => {
    answer(200, { model_id: 'm', state: 'running' });
    await request(app.getHttpServer()).post('/api/updates/models/qwen%20x').expect(200, { model_id: 'm', state: 'running' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/updates/models/qwen%20x' });
    answer(200, { state: 'running', variant: 'metal' });
    await request(app.getHttpServer()).post('/api/updates/engines/sdcpp').expect(200, { state: 'running', variant: 'metal' });
    expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/updates/engines/sdcpp?target=pinned' });
  });

  it('installs the pinned release by default and the latest one only when asked, the target checked against a white list', async () => {
    answer(200, { state: 'running' });
    await request(app.getHttpServer()).post('/api/updates/engines/sdcpp').expect(200);
    expect(last().url).toBe('/engine/v1/updates/engines/sdcpp?target=pinned');
    await request(app.getHttpServer()).post('/api/updates/engines/sdcpp').send({ target: 'latest' }).expect(200);
    expect(last().url).toBe('/engine/v1/updates/engines/sdcpp?target=latest');
    engine.requests.length = 0;
    for (const body of [{ target: 'master-1' }, { target: 3 }, { target: null }, { target: '' }]) {
      await request(app.getHttpServer()).post('/api/updates/engines/sdcpp').send(body).expect(400);
    }
    expect(engine.requests).toHaveLength(0); // nothing invalid reaches the engine
    await request(app.getHttpServer()).post('/api/updates/engines/sdcpp').send({ other: 'latest' }).expect(200); // unknown keys are ignored: pinned
    expect(last().url).toBe('/engine/v1/updates/engines/sdcpp?target=pinned');
  });

  it('relays the engine refusal (already up to date, in use, busy)', async () => {
    answer(409, { detail: 'Ce modèle est déjà à jour.' });
    const res = await request(app.getHttpServer()).post('/api/updates/models/m').expect(409);
    expect(res.body.message).toBe('Ce modèle est déjà à jour.');
    answer(404, { detail: "Ce moteur n'est pas installé." });
    await request(app.getHttpServer()).post('/api/updates/engines/nope').expect(404);
  });

  it('answers 502 when the engine is unreachable', async () => {
    const down = new UpdatesService(new EngineClient(testConfig('http://127.0.0.1:1')), new UpdateAdvisoryService(dataSource.getRepository(UpdateAdvisoryEntity)), new EngineBusyGate(), queue as never);
    await expect(down.check()).rejects.toMatchObject({ status: 502 });
  });

  describe('advice', () => {
    const engineAdvice = {
      kind: 'engine', id: 'sdcpp', target: 'latest', from_version: 'master-900', to_version: 'master-1002', verdict: 'discouraged',
      summary: 'Un plantage signalé.', findings: [{ severity: 'critical', title: 'Plantage', quote: 'It crashes on load', url: 'https://gh/i/7', source_kind: 'issue' }],
      sources: [{ title: 'Issue #7', url: 'https://gh/i/7' }], notes: [], truncated: 0, rejected: 1, llm_model_id: 'llm-qwen3-4b-instruct-2507', generated_at: 1,
    };
    const advise = (body: unknown) => request(app.getHttpServer()).post('/api/updates/advise').send(body as object);

    it('asks the engine, stores the advice and gives it back; the body reaches the engine as validated', async () => {
      answer(200, engineAdvice);
      const res = await advise({ kind: 'engine', id: 'sdcpp', target: 'latest', ignored: 1 }).expect(200);
      expect(res.body).toMatchObject({ kind: 'engine', item_id: 'sdcpp', to_version: 'master-1002', verdict: 'discouraged', llm_model_id: 'llm-qwen3-4b-instruct-2507' });
      expect(last()).toMatchObject({ method: 'POST', url: '/engine/v1/updates/advice' });
      expect(JSON.parse(last().body.toString())).toEqual({ kind: 'engine', id: 'sdcpp', target: 'latest' });
      const listed = await request(app.getHttpServer()).get('/api/updates/advisories').expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].findings[0]).toMatchObject({ quote: 'It crashes on load', url: 'https://gh/i/7' });
    });

    it('uses the tested release when no target is given', async () => {
      answer(200, { ...engineAdvice, target: 'pinned' });
      await advise({ kind: 'engine', id: 'sdcpp' }).expect(200);
      expect(JSON.parse(last().body.toString()).target).toBe('pinned');
    });

    it('merges the stored advice into the next check, then lets it be removed', async () => {
      answer(200, engineAdvice);
      const saved = (await advise({ kind: 'engine', id: 'sdcpp', target: 'latest' }).expect(200)).body;
      answer(200, { engines: [{ id: 'sdcpp', state: 'update', target: 'master-956', latest: { tag: 'master-1002', regressions: [] } }], models: [], checked_at: 2 });
      const check = (await request(app.getHttpServer()).get('/api/updates/check').expect(200)).body;
      expect(check.engines[0].latest.advice).toMatchObject({ id: saved.id, stale: false });
      expect(check.engines[0].advice).toBeNull();
      await request(app.getHttpServer()).delete(`/api/updates/advisories/${saved.id}`).expect(200, { ok: true });
      await request(app.getHttpServer()).delete(`/api/updates/advisories/${saved.id}`).expect(404);
    });

    it.each([
      [{}], [{ kind: 'pack', id: 'x' }], [{ kind: 'engine' }], [{ kind: 'engine', id: '../etc' }], [{ kind: 'engine', id: '' }],
      [{ kind: 'engine', id: 'x'.repeat(161) }], [{ kind: 'engine', id: 'sdcpp', target: 'newest' }], [{ kind: 'engine', id: 'sdcpp', target: 3 }],
    ])('rejects %j with a 400 and nothing reaches the engine', async (body) => {
      await advise(body).expect(400);
      expect(engine.requests).toHaveLength(0);
    });

    it('refuses while a media generation is running or a chat reply holds the engine, without calling it', async () => {
      queue.occupied = true;
      expect((await advise({ kind: 'engine', id: 'sdcpp' }).expect(409)).body).toMatchObject({ code: 'busy' });
      queue.occupied = false;
      gate.tryAcquire('chat');
      const res = await advise({ kind: 'engine', id: 'sdcpp' }).expect(409);
      expect(res.body).toMatchObject({ code: 'busy' });
      expect(res.body.message).toMatch(/chat/);
      expect(engine.requests).toHaveLength(0);
    });

    it('relays the engine refusals with their code and always releases the gauge', async () => {
      answer(409, { detail: { code: 'no_model', message: 'Aucun modèle de chat installé.' } });
      const res = await advise({ kind: 'model', id: 'wan' }).expect(409);
      expect(res.body).toMatchObject({ code: 'no_model', message: 'Aucun modèle de chat installé.' });
      expect(gate.busy).toBe(false);
      answer(502, { detail: { code: 'no_sources', message: 'Sources illisibles.' } });
      await advise({ kind: 'model', id: 'wan' }).expect(502);
      expect(gate.busy).toBe(false);
      expect(await dataSource.getRepository(UpdateAdvisoryEntity).count()).toBe(0);
    });

    it('lets one analysis run at a time and holds the engine gauge meanwhile (the queue and the chat wait)', async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      engine.handle((_req, res) => {
        void held.then(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(engineAdvice));
        });
      });
      const first = advise({ kind: 'engine', id: 'sdcpp', target: 'latest' }).then((r) => r);
      await new Promise((r) => setTimeout(r, 50));
      expect(gate.heldBy).toBe('update-advice');
      expect((await advise({ kind: 'engine', id: 'sdcpp' }).expect(409)).body.message).toMatch(/déjà en cours/);
      release();
      expect((await first).status).toBe(200);
      expect(gate.busy).toBe(false);
    });
  });
});
