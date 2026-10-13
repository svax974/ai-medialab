/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { EngineClient } from 'src/modules/engine';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { SettingsService } from './SettingsService';

/** In-memory stand-in of the module config (values, secret and the clear-token path). */
function fakeConfig() {
  const store: Record<string, unknown> = {};
  let token = '';
  const moduleConfig = {
    getModuleConfigWithValues: jest.fn(async () => ({ currentValues: { ...store } })),
    getDecryptedSecretValue: jest.fn(() => token),
    updateModuleConfig: jest.fn(async (_id: string, values: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(values)) {
        if (k === 'studio_hfToken') token = v as string;
        else store[k] = v;
      }
      return null;
    }),
  };
  const configuration = {
    getConfiguration: jest.fn(async () => []),
    updateAll: jest.fn(async (dtos: { name: string; value: string }[]) => {
      for (const d of dtos) if (d.name === 'studio_hfToken') token = d.value;
      return [];
    }),
  };
  return { store, moduleConfig, configuration };
}

describe('SettingsService', () => {
  let engine: FakeEngine;
  let cfg: ReturnType<typeof fakeConfig>;
  let service: SettingsService;

  const make = (url: string) => {
    cfg = fakeConfig();
    service = new SettingsService(cfg.moduleConfig as never, cfg.configuration as never, new EngineClient(testConfig(url)));
  };
  const pushed = () => engine.requests.filter((r) => r.method === 'PUT').map((r) => JSON.parse(r.body.toString()));

  beforeEach(async () => {
    engine = await startFakeEngine();
    make(engine.url);
  });
  afterEach(() => engine.close());

  it('returns the defaults and has_hf_token false when nothing is stored', async () => {
    expect(await service.getPublic()).toEqual({ keep_alive_minutes: 10, previews: true, low_memory: true, quantize: {}, variant: {}, has_hf_token: false });
  });

  it('pushes the whole state to the engine, then stores it', async () => {
    const result = await service.update({ keep_alive_minutes: 0, hf_token: 'hf_x', variant: { m: 'q4' } });
    expect(engine.requests[0]).toMatchObject({ method: 'PUT', url: '/engine/v1/runtime/settings' });
    expect(pushed()[0]).toEqual({ keep_alive_minutes: 0, previews: true, low_memory: true, quantize: {}, variant: { m: 'q4' }, hf_token: 'hf_x' });
    expect(result).toEqual({ keep_alive_minutes: 0, previews: true, low_memory: true, quantize: {}, variant: { m: 'q4' }, has_hf_token: true });
    expect(JSON.stringify(result)).not.toContain('hf_x');
    expect((await service.getPublic()).has_hf_token).toBe(true);
  });

  it('merges the model maps with the stored ones', async () => {
    await service.update({ quantize: { a: 4 } });
    await service.update({ quantize: { b: null } });
    expect((await service.getPublic()).quantize).toEqual({ a: 4, b: null });
  });

  it('removes the token with an empty string', async () => {
    await service.update({ hf_token: 'hf_x' });
    const result = await service.update({ hf_token: '' });
    expect(result.has_hf_token).toBe(false);
    expect(cfg.configuration.updateAll).toHaveBeenCalledWith([{ name: 'studio_hfToken', value: '', description: '' }]);
    expect(pushed().at(-1).hf_token).toBe('');
  });

  it('relays the engine refusal and stores nothing', async () => {
    engine.handle((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Quantification inconnue pour m : zz.' }));
    });
    const err = await service.update({ variant: { m: 'zz' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err).toMatchObject({ status: 422, response: 'Quantification inconnue pour m : zz.' });
    expect(cfg.moduleConfig.updateModuleConfig).not.toHaveBeenCalled();
  });

  it('stores the values when the engine is unreachable (they are sent when it connects)', async () => {
    await engine.close();
    engine = await startFakeEngine();
    make('http://127.0.0.1:1');
    const result = await service.update({ previews: false });
    expect(result.previews).toBe(false);
    expect(cfg.moduleConfig.updateModuleConfig).toHaveBeenCalled();
  });

  it('pushToEngine sends the stored state and reports failures without throwing', async () => {
    await service.update({ low_memory: false });
    engine.requests.length = 0;
    expect(await service.pushToEngine()).toBe(true);
    expect(pushed()[0].low_memory).toBe(false);
    make('http://127.0.0.1:1');
    expect(await service.pushToEngine()).toBe(false);
  });
});
