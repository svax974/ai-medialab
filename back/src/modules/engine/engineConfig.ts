/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** Connection settings of the internal Python engine (`engine/`), read from the environment. */

export const ENGINE_CONFIG = 'ENGINE_CONFIG';

/** Path prefix of the internal API (see `engine/openapi.json`). */
export const ENGINE_API_PREFIX = '/engine/v1';
export const ENGINE_TOKEN_HEADER = 'X-Engine-Token';

/**
 * First path segments of the engine API (after `/engine/v1/`). `EngineMedia.spec.ts` checks that this list matches
 * `engine/openapi.json`, so a new area of the engine is a conscious decision on the Nest side.
 */
export const ENGINE_API_SEGMENTS = ['engine', 'engines', 'events', 'hf', 'jobs', 'llm', 'media', 'models', 'runtime', 'status', 'system', 'updates'] as const;

export interface EngineConfig {
  /** Base URL, no trailing slash. Loopback only in practice (the engine listens on 127.0.0.1). */
  url: string;
  /** Shared secret sent as `X-Engine-Token`; empty means "none" (the engine then accepts any caller). */
  token: string;
  /** Default timeout of a typed call, in milliseconds. */
  timeoutMs: number;
  /** Subscribe to the engine event stream at startup (`ENGINE_EVENTS_RELAY=false` disables it). */
  relayEvents: boolean;
  /** Reconnection backoff of the event stream: first and maximum delay, in milliseconds. */
  reconnectMinMs: number;
  reconnectMaxMs: number;
  /** The engine pings every 15 s: no byte for this long means a dead connection. */
  idleTimeoutMs: number;
}

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** `ENGINE_URL` wins; otherwise `http://127.0.0.1:<ENGINE_PORT, default 8000>`. */
export function resolveEngineConfig(env: Env = process.env): EngineConfig {
  const port = positiveInt(env.ENGINE_PORT, 8000);
  const url = (env.ENGINE_URL?.trim() || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  return {
    url,
    token: env.ENGINE_TOKEN?.trim() ?? '',
    timeoutMs: positiveInt(env.ENGINE_TIMEOUT_MS, 30_000),
    relayEvents: (env.ENGINE_EVENTS_RELAY ?? 'true').toLowerCase() !== 'false',
    reconnectMinMs: positiveInt(env.ENGINE_RECONNECT_MIN_MS, 1_000),
    reconnectMaxMs: positiveInt(env.ENGINE_RECONNECT_MAX_MS, 15_000),
    idleTimeoutMs: positiveInt(env.ENGINE_IDLE_TIMEOUT_MS, 45_000),
  };
}
