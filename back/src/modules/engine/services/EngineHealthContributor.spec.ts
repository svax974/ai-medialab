/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { startFakeEngine, testConfig, type FakeEngine } from '../testing/fakeEngine';
import { EngineClient } from './EngineClient';
import { EngineEventRelay } from './EngineEventRelay';
import { EngineHealthContributor } from './EngineHealthContributor';

describe('EngineHealthContributor', () => {
  let engine: FakeEngine;
  let contributor: EngineHealthContributor;

  beforeEach(async () => {
    engine = await startFakeEngine();
    const config = testConfig(engine.url);
    const client = new EngineClient(config);
    const relay = new EngineEventRelay(client, { publish: () => undefined } as never, config);
    contributor = new EngineHealthContributor(client, relay);
  });
  afterEach(() => engine.close());

  it('is keyed "engine" and reports ok with the engine status', async () => {
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: 'idle' }));
    });
    expect(contributor.key).toBe('engine');
    await expect(contributor.check()).resolves.toEqual({ status: 'ok', events: false, engine: { state: 'idle' } });
    expect(engine.requests[0].url).toBe('/engine/v1/status');
  });

  it('reports degraded (not down) when the engine is unreachable', async () => {
    await engine.close();
    const result = await contributor.check();
    expect(result.status).toBe('degraded');
    expect(String(result.error)).toMatch(/unreachable/);
    engine = await startFakeEngine();
  });
});
