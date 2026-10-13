/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { resolveEngineConfig } from './engineConfig';

describe('resolveEngineConfig', () => {
  it('defaults to the loopback engine on port 8000', () => {
    expect(resolveEngineConfig({})).toMatchObject({ url: 'http://127.0.0.1:8000', token: '', relayEvents: true });
  });

  it('derives the URL from ENGINE_PORT and lets ENGINE_URL win (trailing slash removed)', () => {
    expect(resolveEngineConfig({ ENGINE_PORT: '8123' }).url).toBe('http://127.0.0.1:8123');
    expect(resolveEngineConfig({ ENGINE_PORT: '8123', ENGINE_URL: 'http://127.0.0.1:9/' }).url).toBe('http://127.0.0.1:9');
  });

  it('reads the token, the relay switch and ignores invalid numbers', () => {
    const cfg = resolveEngineConfig({ ENGINE_TOKEN: ' secret ', ENGINE_EVENTS_RELAY: 'false', ENGINE_TIMEOUT_MS: 'abc' });
    expect(cfg).toMatchObject({ token: 'secret', relayEvents: false, timeoutMs: 30_000 });
  });
});
