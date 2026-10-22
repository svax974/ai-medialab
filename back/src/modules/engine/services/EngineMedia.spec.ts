/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
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
import { EngineMediaController } from '../controllers/EngineMediaController';
import { ENGINE_API_SEGMENTS, ENGINE_CONFIG } from '../engineConfig';
import { startFakeEngine, testConfig, TEST_TOKEN, type FakeEngine } from '../testing/fakeEngine';
import { EngineMediaService, toEngineMediaPath } from './EngineMediaService';

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

describe('toEngineMediaPath', () => {
  it('maps /api/media to the media mounts of the engine, query string kept', () => {
    expect(toEngineMediaPath('/api/media/outputs/a.png')).toBe('/media/outputs/a.png');
    expect(toEngineMediaPath('/api/media/thumbs/b.webp?t=1')).toBe('/media/thumbs/b.webp?t=1');
  });

  it('leaves everything else alone', () => {
    for (const url of ['/api/media', '/api/media/', '/api', '/api/v1/health', '/api/events', '/api/models', '/media/outputs/a.png', '/api-json']) expect(toEngineMediaPath(url)).toBeNull();
  });
});

describe('EngineMedia (fake engine)', () => {
  let engine: FakeEngine;
  let app: INestApplication;

  async function boot(url: string): Promise<void> {
    @Module({
      controllers: [EngineMediaController, NestOwnController],
      providers: [{ provide: ENGINE_CONFIG, useValue: testConfig(url) }, EngineMediaService, { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor }],
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
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([1, 2, 3]));
    });
  });

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await request(app.getHttpServer()).get('/api/media/outputs/a.png').expect(401);
    principal = { id: 5, admin: false, kind: 'user' };
    await request(app.getHttpServer()).get('/api/media/outputs/a.png').expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  it('relays the file without the token and drops the Nest authorization', async () => {
    const res = await request(app.getHttpServer()).get('/api/media/outputs/a.png?t=1').set('Authorization', 'Bearer admin-secret').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(engine.requests[0].url).toBe('/media/outputs/a.png?t=1');
    expect(engine.requests[0].headers['x-engine-token']).toBeUndefined();
    expect(engine.requests[0].headers.authorization).toBeUndefined();
    expect(TEST_TOKEN).not.toBe('');
  });

  it('relays range requests (audio and video seeking)', async () => {
    engine.handle((_req, res) => {
      res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/10' });
      res.end(Buffer.from([1, 2]));
    });
    const res = await request(app.getHttpServer()).get('/api/media/outputs/a.mp4').set('Range', 'bytes=0-1').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-1/10');
    expect(engine.requests[0].headers.range).toBe('bytes=0-1');
  });

  it('passes the engine error status through', async () => {
    engine.handle((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Not Found' }));
    });
    const res = await request(app.getHttpServer()).get('/api/media/outputs/nope.png').expect(404);
    expect(res.body).toEqual({ detail: 'Not Found' });
  });

  it('does not relay anything else: no /api/events, no model routes, Nest routes untouched', async () => {
    await request(app.getHttpServer()).get('/api/events').expect(404);
    await request(app.getHttpServer()).get('/api/models').expect(404);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
    expect(engine.requests).toHaveLength(0);
  });

  it('answers 502 when the engine is down', async () => {
    const dead = await startFakeEngine();
    const deadUrl = dead.url;
    await dead.close();
    const other = await Test.createTestingModule({
      controllers: [EngineMediaController],
      providers: [{ provide: ENGINE_CONFIG, useValue: testConfig(deadUrl) }, EngineMediaService],
    }).compile();
    const downApp = other.createNestApplication();
    downApp.use((req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
      req.user = { admin: true };
      next();
    });
    await downApp.init();
    await request(downApp.getHttpServer()).get('/api/media/outputs/a.png').expect(502, { statusCode: 502, message: 'Engine unavailable' });
    await downApp.close();
  });
});

describe('engine API coverage', () => {
  it('ENGINE_API_SEGMENTS lists exactly the first path segments of engine/openapi.json', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schema = require('../../../../../engine/openapi.json') as { paths: Record<string, unknown> };
    const segments = [...new Set(Object.keys(schema.paths).map((p) => p.replace('/engine/v1/', '').split('/')[0]))].sort();
    expect(segments).toEqual([...ENGINE_API_SEGMENTS].sort());
  });

  it('no path outside /engine/v1 is in the schema (the former /api prefix is gone)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schema = require('../../../../../engine/openapi.json') as { paths: Record<string, unknown> };
    expect(Object.keys(schema.paths).filter((p) => !p.startsWith('/engine/v1/'))).toEqual([]);
  });
});
