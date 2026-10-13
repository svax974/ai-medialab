/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { startFakeEngine, testConfig, TEST_TOKEN, type FakeEngine } from '../testing/fakeEngine';
import { EngineClient } from './EngineClient';
import { EngineError, EngineUnavailableError } from './EngineError';

describe('EngineClient', () => {
  let engine: FakeEngine;
  let client: EngineClient;

  beforeEach(async () => {
    engine = await startFakeEngine();
    client = new EngineClient(testConfig(engine.url));
  });
  afterEach(() => engine.close());

  it('sends the engine token and parses a typed JSON answer', async () => {
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: 'idle' }));
    });
    const status = await client.get('/engine/v1/status');
    expect(status).toEqual({ state: 'idle' });
    expect(engine.requests[0].headers['x-engine-token']).toBe(TEST_TOKEN);
    expect(engine.requests[0].headers.accept).toBe('application/json');
  });

  it('fills path parameters (encoded) and the query string', async () => {
    await client.get('/engine/v1/assets', { query: { media: 'audio' } });
    await client.delete('/engine/v1/assets/{asset_id}', { params: { asset_id: 'a/b c' } });
    expect(engine.requests[0].url).toBe('/engine/v1/assets?media=audio');
    expect(engine.requests[1]).toMatchObject({ method: 'DELETE', url: '/engine/v1/assets/a%2Fb%20c' });
  });

  it('sends a JSON body with its content type', async () => {
    await client.post('/engine/v1/conversations', { body: { mode: 'image', title: 'Hello' } });
    expect(engine.requests[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(engine.requests[0].body.toString())).toEqual({ mode: 'image', title: 'Hello' });
  });

  it('sends a multipart body untouched', async () => {
    const form = new FormData();
    form.append('files', new Blob(['abc']), 'a.txt');
    await client.post('/engine/v1/assets', { form });
    expect(engine.requests[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(engine.requests[0].body.toString()).toContain('abc');
  });

  it('throws EngineError with the FastAPI detail on a non-2xx answer', async () => {
    engine.handle((_req, res) => {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Busy' }));
    });
    const err = await client.get('/engine/v1/models').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ status: 409, detail: 'Busy' });
  });

  it('returns undefined for an empty or non-JSON answer', async () => {
    engine.handle((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await expect(client.delete('/engine/v1/engine/unload')).resolves.toBeUndefined();
  });

  it('throws EngineUnavailableError when nothing listens', async () => {
    await engine.close();
    await expect(client.get('/engine/v1/status')).rejects.toBeInstanceOf(EngineUnavailableError);
    engine = await startFakeEngine();
  });

  it('times out slow calls', async () => {
    engine.handle(() => undefined);
    await expect(client.get('/engine/v1/status', { timeoutMs: 50 })).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it('omits the token header when none is configured', async () => {
    const open = new EngineClient(testConfig(engine.url, { token: '' }));
    await open.get('/engine/v1/status');
    expect(engine.requests[0].headers['x-engine-token']).toBeUndefined();
  });

  it('refuses a missing path parameter', () => {
    expect(() => client.buildUrl('/engine/v1/assets/{asset_id}', {})).toThrow(/asset_id/);
  });

  it('openEventStream returns the unread event-stream response', async () => {
    const ctrl = new AbortController();
    const res = await client.openEventStream(ctrl.signal);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    ctrl.abort();
  });
});
