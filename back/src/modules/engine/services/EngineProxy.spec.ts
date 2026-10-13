/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { CallHandler, Controller, ExecutionContext, Get, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { EngineProxyController } from '../controllers/EngineProxyController';
import { ENGINE_CONFIG } from '../engineConfig';
import { startFakeEngine, testConfig, TEST_TOKEN, type FakeEngine } from '../testing/fakeEngine';
import { EngineProxyService, PROXIED_SEGMENTS, toEnginePath } from './EngineProxyService';

@Controller()
class NestOwnController {
  @Get('api/v1/health')
  health() {
    return { status: 'ok' };
  }
}

let principal: AuthPrincipal | undefined;

/** Stands in for GlobalAuthInterceptor: same `applyPrincipal`, which mirrors `uid`/`user` into body, params and query. */
@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

describe('toEnginePath', () => {
  it('maps proxied segments to /engine/v1 and media to /media', () => {
    expect(toEnginePath('/api/models?x=1')).toBe('/engine/v1/models?x=1');
    expect(toEnginePath('/api/messages/abc/cancel')).toBe('/engine/v1/messages/abc/cancel');
    expect(toEnginePath('/api/media/outputs/a.png')).toBe('/media/outputs/a.png');
  });

  it('leaves Nest routes, Swagger and unknown segments alone', () => {
    for (const url of ['/api', '/api/v1/health', '/api/unknown', '/models', '/api-json']) expect(toEnginePath(url)).toBeNull();
  });
});

describe('EngineProxy (fake engine)', () => {
  let engine: FakeEngine;
  let app: INestApplication;

  async function boot(url: string): Promise<void> {
    @Module({
      controllers: [EngineProxyController, NestOwnController],
      providers: [{ provide: ENGINE_CONFIG, useValue: testConfig(url) }, EngineProxyService, { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor }],
    })
    class TestModule {}
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  beforeAll(async () => {
    engine = await startFakeEngine();
    principal = { id: 0, admin: true, kind: 'local-trust' };
    await boot(engine.url);
  });
  afterAll(async () => {
    await app.close();
    await engine.close();
  });
  afterEach(() => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    engine.requests.length = 0;
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await request(app.getHttpServer()).get('/api/models').expect(401);
    principal = { id: 5, admin: false, kind: 'user' };
    await request(app.getHttpServer()).get('/api/models').expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  it('relays GET with query string, adds the token, drops the Nest authorization', async () => {
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-from': 'engine' });
      res.end(JSON.stringify({ models: [] }));
    });
    const res = await request(app.getHttpServer()).get('/api/models?refresh=true').set('Authorization', 'Bearer admin-secret').expect(200);
    expect(res.body).toEqual({ models: [] });
    expect(res.headers['x-from']).toBe('engine');
    expect(engine.requests[0].url).toBe('/engine/v1/models?refresh=true');
    expect(engine.requests[0].headers['x-engine-token']).toBe(TEST_TOKEN);
    expect(engine.requests[0].headers.authorization).toBeUndefined();
  });

  it('relays a JSON body, without the uid/user members mirrored by the auth interceptor', async () => {
    engine.handle((_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'c1' }));
    });
    const res = await request(app.getHttpServer()).post('/api/conversations').send({ mode: 'image', title: 'T' }).expect(201);
    expect(res.body).toEqual({ id: 'c1' });
    const sent = JSON.parse(engine.requests[0].body.toString()) as Record<string, unknown>;
    expect(sent).toEqual({ mode: 'image', title: 'T' });
    expect(engine.requests[0].headers['content-type']).toContain('application/json');
  });

  it('streams a multipart upload to the engine untouched', async () => {
    const payload = Buffer.alloc(300_000, 7);
    await request(app.getHttpServer()).post('/api/assets').attach('files', payload, 'big.bin').expect(200);
    const rec = engine.requests[0];
    expect(rec.url).toBe('/engine/v1/assets');
    expect(rec.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(rec.body.length).toBeGreaterThan(300_000);
    expect(rec.body.includes(payload)).toBe(true);
  });

  it('relays the event stream chunk by chunk with no-transform headers', async () => {
    const received = await new Promise<string>((resolve, reject) => {
      const server = app.getHttpServer();
      const listening = server.listening ? Promise.resolve() : new Promise<void>((r) => server.listen(0, r));
      void listening.then(() => {
        const { port } = server.address() as { port: number };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const req = require('http').get({ host: '127.0.0.1', port, path: '/api/events' }, (res: import('http').IncomingMessage) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          expect(res.headers['cache-control']).toBe('no-cache, no-transform');
          expect(res.headers['x-accel-buffering']).toBe('no');
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (chunk.includes('engine.status')) {
              req.destroy();
              resolve(chunk);
            }
          });
        });
        req.on('error', reject);
        setTimeout(() => engine.streams.at(-1)?.write('event: engine.status\ndata: {"state":"idle"}\n\n'), 100);
      });
    });
    expect(received).toContain('engine.status');
    expect(engine.requests.find((r) => r.url === '/engine/v1/events')?.headers['x-engine-token']).toBe(TEST_TOKEN);
  });

  it('relays media without the token, with range headers, under /api/media', async () => {
    engine.handle((_req, res) => {
      res.writeHead(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-1/10' });
      res.end(Buffer.from([1, 2]));
    });
    const res = await request(app.getHttpServer()).get('/api/media/outputs/a.png').set('Range', 'bytes=0-1').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-1/10');
    expect(engine.requests[0].url).toBe('/media/outputs/a.png');
    expect(engine.requests[0].headers['x-engine-token']).toBeUndefined();
    expect(engine.requests[0].headers.range).toBe('bytes=0-1');
  });

  it('passes the engine error status through', async () => {
    engine.handle((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Modèle inconnu.' }));
    });
    const res = await request(app.getHttpServer()).get('/api/models/nope').expect(404);
    expect(res.body).toEqual({ detail: 'Modèle inconnu.' });
  });

  it('does not touch the routes Nest serves itself', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).get('/api/unknown').expect(404);
    expect(engine.requests).toHaveLength(0);
  });

  it('answers 502 when the engine is down', async () => {
    const dead = await startFakeEngine();
    const deadUrl = dead.url;
    await dead.close();
    const other = await Test.createTestingModule({
      controllers: [EngineProxyController],
      providers: [{ provide: ENGINE_CONFIG, useValue: testConfig(deadUrl) }, EngineProxyService],
    }).compile();
    const downApp = other.createNestApplication();
    downApp.use((req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
      req.user = { admin: true };
      next();
    });
    await downApp.init();
    await request(downApp.getHttpServer()).get('/api/models').expect(502, { statusCode: 502, message: 'Engine unavailable' });
    await downApp.close();
  });

  it('covers every first path segment of the engine OpenAPI schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schema = require('../../../../../engine/openapi.json') as { paths: Record<string, unknown> };
    const segments = new Set(Object.keys(schema.paths).map((p) => p.replace('/engine/v1/', '').split('/')[0]));
    expect([...segments].filter((s) => !(PROXIED_SEGMENTS as readonly string[]).includes(s))).toEqual([]);
  });
});
