/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { EngineClient } from 'src/modules/engine';
import { ENGINE_CONFIG } from 'src/modules/engine/engineConfig';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { AssetService, StudioEvents } from 'src/modules/media-library';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { VoiceFileService } from '../services/VoiceFileService';
import { VoiceService } from '../services/VoiceService';
import { VoiceController } from './VoiceController';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

let tooShort = false;
const PEAKS = Array.from({ length: 120 }, (_, i) => (i % 10) / 10);

/** `/api/voices*` over a fake engine: same URLs, forms and error texts as the legacy engine routes. */
describe('voice routes', () => {
  let dataSource: DataSource;
  let services: ReturnType<typeof buildServices>;
  let engine: FakeEngine;
  let app: INestApplication;
  const published: { topic: string; type: string }[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), 'voice-routes-'));

  const calls = (url: string) => engine.requests.filter((r) => r.url === url).map((r) => JSON.parse(r.body.toString()) as Record<string, unknown>);

  beforeAll(async () => {
    process.env.APP_DATA_DIR = dataDir;
    engine = await startFakeEngine();
    engine.handle((req, res) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const body = req.body.length ? (JSON.parse(req.body.toString()) as Record<string, string>) : {};
      if (req.url === '/engine/v1/media/voice-reference') {
        if (tooShort) return json(422, { detail: 'Extrait trop court : il faut au moins une seconde de parole.' });
        return json(200, { filename: `voice_${body.voice_id}.wav`, duration: 4.5, peaks: PEAKS });
      }
      if (req.url === '/engine/v1/media/transcribe') {
        if (body.model_id === 'none') return json(409, { detail: 'Aucun modèle de transcription n\'est téléchargé.' });
        return json(200, { text: 'bonjour à tous', language: body.language ?? null, duration: 4.5, model: 'whisper-small' });
      }
      return json(200, { deleted: 1 });
    });
    dataSource = await createTestDataSource();
    services = buildServices(dataSource);
    const events = new StudioEvents({ publish: (topic: string, event: { type: string }) => published.push({ topic, type: event.type }) } as never);
    const files = new VoiceFileService(services.voices, services.assets, new EngineClient(testConfig(engine.url)), events);

    @Module({
      controllers: [VoiceController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        { provide: VoiceService, useValue: services.voices },
        { provide: VoiceFileService, useValue: files },
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
  afterEach(() => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
    published.length = 0;
    engine.requests.length = 0;
  });

  const http = () => request(app.getHttpServer());

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await http().get('/api/voices').expect(401);
  });

  it('POST /api/voices: the engine prepares the clip, Nest stores the row in the legacy form and removes the raw upload', async () => {
    const res = await http()
      .post('/api/voices')
      .field('name', 'Ma voix').field('transcript', ' salut ').field('language', 'fr').field('kind', 'clone')
      .attach('file', Buffer.from('riff'), 'échantillon.wav')
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['created_at', 'description', 'duration', 'id', 'kind', 'language', 'name', 'peaks', 'transcript', 'url']);
    expect(res.body).toMatchObject({
      name: 'Ma voix', kind: 'clone', transcript: 'salut', language: 'fr', duration: 4.5, description: '',
      url: `/media/uploads/voice_${res.body.id}.wav`,
    });
    expect(res.body.peaks).toHaveLength(120);
    const [prepare] = calls('/engine/v1/media/voice-reference');
    expect(String(prepare.source_path).startsWith(join(dataDir, 'uploads', 'tmp_'))).toBe(true);
    expect(prepare.voice_id).toBe(res.body.id);
    expect(existsSync(String(prepare.source_path))).toBe(false); // the engine leaves it, Nest removes it
    expect(readdirSync(join(dataDir, 'uploads')).filter((f) => f.startsWith('tmp_'))).toEqual([]);
    expect(published.map((e) => e.topic)).toEqual(['studio.voices.changed']);
    expect((await http().get('/api/voices').expect(200)).body.map((v: { id: string }) => v.id)).toContain(res.body.id);
  });

  it('POST /api/voices: the name falls back on the file name then "Ma voix"; a design voice is kept as such; no file is a 422', async () => {
    const named = await http().post('/api/voices').attach('file', Buffer.from('x'), 'Narrateur grave.mp3').expect(200);
    expect(named.body).toMatchObject({ name: 'Narrateur grave', kind: 'clone', language: null });
    const design = await http().post('/api/voices').field('kind', 'design').field('description', 'voix grave').attach('file', Buffer.from('x'), '.wav').expect(200);
    expect(design.body).toMatchObject({ kind: 'design', description: 'voix grave' });
    await http().post('/api/voices').field('name', 'x').expect(422);
  });

  it('POST /api/voices: a clip the engine refuses is a 422 with its message and leaves no row, no file', async () => {
    const before = (await http().get('/api/voices')).body.length;
    tooShort = true;
    const res = await http().post('/api/voices').attach('file', Buffer.from('x'), 'short.wav').expect(422);
    tooShort = false;
    expect(res.body.message).toMatch(/au moins une seconde/);
    expect((await http().get('/api/voices')).body).toHaveLength(before);
    expect(readdirSync(join(dataDir, 'uploads')).filter((f) => f.startsWith('tmp_'))).toEqual([]);
    expect(published).toEqual([]);
  });

  it('POST /api/voices/from-asset: keeps a take, filling the blanks from its metadata; 404 for an unknown or non-audio asset', async () => {
    await services.assets.create({ id: 'take1', kind: 'generated', media: 'audio', filename: 'a_0.wav', meta: { voice: 'Voix décrite', prompt: 'x'.repeat(700), instruct: 'une voix douce', language: 'fr' } });
    await services.assets.create({ id: 'img1', kind: 'generated', media: 'image', filename: 'i.png' });
    const res = await http().post('/api/voices/from-asset').send({ asset_id: 'take1' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Voix décrite', kind: 'design', description: 'une voix douce', language: 'fr' });
    expect(res.body.transcript).toHaveLength(600);
    expect(calls('/engine/v1/media/voice-reference')[0].source_path).toBe(join(dataDir, 'outputs', 'a_0.wav'));
    const custom = await http().post('/api/voices/from-asset').send({ asset_id: 'take1', name: 'Alice', kind: 'clone', transcript: 'salut' }).expect(200);
    expect(custom.body).toMatchObject({ name: 'Alice', kind: 'clone', transcript: 'salut' });
    expect((await http().post('/api/voices/from-asset').send({ asset_id: 'img1' }).expect(404)).body.message).toBe('Prise audio introuvable.');
    await http().post('/api/voices/from-asset').send({ asset_id: 'ghost' }).expect(404);
    await http().post('/api/voices/from-asset').send({}).expect(422);
  });

  it('PATCH /api/voices/:id: edits the transcript and the other fields, 404 and 422 as before', async () => {
    const v = await services.voices.create({ id: 'pv', name: 'A', kind: 'clone', filename: 'voice_pv.wav', transcript: 'ancien' });
    published.length = 0;
    const res = await http().patch(`/api/voices/${v.id}`).send({ transcript: 'nouveau texte', name: '  Bob  ' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Bob', transcript: 'nouveau texte' });
    expect((await http().patch(`/api/voices/${v.id}`).send({ transcript: '' }).expect(200)).body.transcript).toBe('');
    expect((await http().patch('/api/voices/ghost').send({ name: 'x' }).expect(404)).body.message).toBe('Voix introuvable.');
    await http().patch(`/api/voices/${v.id}`).send({ name: 5 }).expect(422);
    expect(published.map((e) => e.type)).toEqual(['voices.changed', 'voices.changed']);
  });

  it('POST /api/voices/:id/transcribe: asks the engine for a suggestion on the stored clip and stores nothing', async () => {
    await services.voices.create({ id: 'tv', name: 'T', kind: 'clone', filename: 'voice_tv.wav', transcript: 'garde', language: 'fr' });
    const res = await http().post('/api/voices/tv/transcribe').send({}).expect(200);
    expect(res.body).toEqual({ text: 'bonjour à tous', language: 'fr', duration: 4.5, model: 'whisper-small' });
    expect(calls('/engine/v1/media/transcribe')[0]).toEqual({ path: join(dataDir, 'uploads', 'voice_tv.wav'), language: 'fr', model_id: null });
    expect((await services.voices.get('tv'))?.transcript).toBe('garde');
    const asked = await http().post('/api/voices/tv/transcribe').send({ language: 'en', model_id: 'whisper-small' }).expect(200);
    expect(asked.body.language).toBe('en');
    const refused = await http().post('/api/voices/tv/transcribe').send({ model_id: 'none' }).expect(409);
    expect(refused.body.message).toMatch(/Aucun modèle de transcription/);
    expect((await http().post('/api/voices/ghost/transcribe').send({}).expect(404)).body.message).toBe('Voix introuvable.');
  });

  it('DELETE /api/voices/:id: removes the row then the sample through the engine; 404 when unknown', async () => {
    await services.voices.create({ id: 'dv', name: 'D', kind: 'clone', filename: 'voice_dv.wav' });
    published.length = 0;
    expect((await http().delete('/api/voices/dv').expect(200)).body).toEqual({ ok: true });
    expect(await services.voices.get('dv')).toBeNull();
    expect(calls('/engine/v1/media/purge')[0]).toEqual({ files: [{ folder: 'uploads', filename: 'voice_dv.wav' }] });
    expect(published.map((e) => e.topic)).toEqual(['studio.voices.changed']);
    expect((await http().delete('/api/voices/dv').expect(404)).body.message).toBe('Voix introuvable.');
  });

  it('keeps AssetService reachable for the module (guards the test wiring)', () => {
    expect(services.assets).toBeInstanceOf(AssetService);
  });
});
