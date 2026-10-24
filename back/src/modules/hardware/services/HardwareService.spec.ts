/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { EmergencyStopService, EngineClient } from 'src/modules/engine';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { HardwareService } from './HardwareService';

describe('HardwareService', () => {
  let engine: FakeEngine;
  let service: HardwareService;

  const answer = (status: number, body: unknown) =>
    engine.handle((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });

  beforeEach(async () => {
    engine = await startFakeEngine();
    service = new HardwareService(new EngineClient(testConfig(engine.url)));
  });
  afterEach(() => engine.close());

  it('relays the machine description, with refresh when asked', async () => {
    answer(200, { os: 'Darwin', ram_gb: 32 });
    expect(await service.system()).toEqual({ os: 'Darwin', ram_gb: 32 });
    await service.system(true);
    expect(engine.requests.map((r) => r.url)).toEqual(['/engine/v1/system', '/engine/v1/system?refresh=true']);
  });

  it('reads the engine status', async () => {
    answer(200, { state: 'ready', model_id: 'm' });
    expect(await service.status()).toEqual({ state: 'ready', model_id: 'm' });
    expect(engine.requests[0].url).toBe('/engine/v1/status');
  });

  it('unloads the model with a POST', async () => {
    answer(200, { state: 'idle' });
    expect(await service.unload()).toEqual({ state: 'idle' });
    expect(engine.requests[0]).toMatchObject({ method: 'POST', url: '/engine/v1/engine/unload' });
  });

  it('reads the live memory', async () => {
    answer(200, { total_gb: 36, used_pct: 79.1 });
    expect(await service.memory()).toEqual({ total_gb: 36, used_pct: 79.1 });
    expect(engine.requests[0].url).toBe('/engine/v1/memory');
  });

  it('empties the application queues before the engine kills its models', async () => {
    const emergency = new EmergencyStopService();
    const order: string[] = [];
    emergency.onStop(async () => void order.push('queues'));
    const withStop = new HardwareService(new EngineClient(testConfig(engine.url)), emergency);
    engine.handle((_req, res) => {
      order.push('engine');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stopped: ['m'], cancelled: 2 }));
    });
    expect(await withStop.emergencyStop()).toEqual({ stopped: ['m'], cancelled: 2 });
    expect(order).toEqual(['queues', 'engine']);
    expect(engine.requests[0]).toMatchObject({ method: 'POST', url: '/engine/v1/engine/emergency-stop' });
  });

  it('relays the engine status and message (409 while a generation runs)', async () => {
    answer(409, { detail: 'Une génération est en cours.' });
    const err = await service.unload().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err).toMatchObject({ status: 409, response: 'Une génération est en cours.' });
  });

  it('answers 502 when the engine is unreachable', async () => {
    const down = new HardwareService(new EngineClient(testConfig('http://127.0.0.1:1')));
    await expect(down.status()).rejects.toMatchObject({ status: 502 });
  });
});
