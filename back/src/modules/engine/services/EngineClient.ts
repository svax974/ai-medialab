/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Inject, Injectable } from '@nestjs/common';
import { ENGINE_CONFIG, ENGINE_TOKEN_HEADER, type EngineConfig } from '../engineConfig';
import type { EnginePath, EngineRequestOptions, EngineResponse, HttpMethod } from '../types/engineTypes';
import { EngineError, EngineUnavailableError } from './EngineError';

/**
 * Typed HTTP client of the internal engine API (`/engine/v1`). Paths, query, path parameters, JSON bodies and
 * responses are typed from `engine/openapi.json`.
 *
 * Plain `fetch` rather than `throttledFetch`: that helper protects quota-limited third-party APIs (spacing between
 * calls, backoff on 5xx, stale answers), none of which suits a local process we own, where a 5xx must surface at once
 * and calls (status polling, downloads, jobs) must never be delayed.
 */
@Injectable()
export class EngineClient {
  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  /** Headers carrying the shared secret. */
  authHeaders(): Record<string, string> {
    return this.config.token ? { [ENGINE_TOKEN_HEADER]: this.config.token } : {};
  }

  /** Absolute URL of an engine path (`{name}` placeholders filled from `params`, values encoded). */
  buildUrl(path: string, params?: unknown, query?: unknown): string {
    const filled = path.replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = (params as Record<string, unknown> | undefined)?.[key];
      if (value === undefined || value === null) throw new Error(`Missing path parameter "${key}" for ${path}`);
      return encodeURIComponent(String(value));
    });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
    }
    const qs = search.toString();
    return `${this.config.url}${filled}${qs ? `?${qs}` : ''}`;
  }

  async request<P extends EnginePath<M>, M extends HttpMethod>(
    method: M,
    path: P,
    options: EngineRequestOptions<P, M> = {},
  ): Promise<EngineResponse<P, M>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...this.authHeaders() };
    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    const url = this.buildUrl(path, options.params, options.query);
    const signals = [AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs)];
    if (options.signal) signals.push(options.signal);
    let res: Response;
    try {
      res = await fetch(url, { method: method.toUpperCase(), headers, body, signal: AbortSignal.any(signals) });
    } catch (err) {
      throw new EngineUnavailableError(path, err);
    }
    return this.parse(res, path) as Promise<EngineResponse<P, M>>;
  }

  get<P extends EnginePath<'get'>>(path: P, options?: EngineRequestOptions<P, 'get'>) {
    return this.request('get', path, options);
  }

  post<P extends EnginePath<'post'>>(path: P, options?: EngineRequestOptions<P, 'post'>) {
    return this.request('post', path, options);
  }

  put<P extends EnginePath<'put'>>(path: P, options?: EngineRequestOptions<P, 'put'>) {
    return this.request('put', path, options);
  }

  patch<P extends EnginePath<'patch'>>(path: P, options?: EngineRequestOptions<P, 'patch'>) {
    return this.request('patch', path, options);
  }

  delete<P extends EnginePath<'delete'>>(path: P, options?: EngineRequestOptions<P, 'delete'>) {
    return this.request('delete', path, options);
  }

  /**
   * Opens the engine event stream (`GET /engine/v1/events`, SSE). The response body is returned unread: the caller
   * owns reading and cancelling it (`signal`). Unlike `request`, there is no timeout (the stream is long-lived).
   */
  async openEventStream(signal: AbortSignal): Promise<Response> {
    const path = '/engine/v1/events';
    let res: Response;
    try {
      res = await fetch(this.buildUrl(path), { headers: { Accept: 'text/event-stream', ...this.authHeaders() }, signal });
    } catch (err) {
      throw new EngineUnavailableError(path, err);
    }
    if (!res.ok || !res.body) throw new EngineError(res.status, path, await res.text().catch(() => ''));
    return res;
  }

  private async parse(res: Response, path: string): Promise<unknown> {
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    if (!res.ok) {
      const payload: unknown = isJson ? await res.json().catch(() => undefined) : await res.text().catch(() => '');
      const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : payload;
      throw new EngineError(res.status, path, detail);
    }
    return isJson ? res.json() : undefined;
  }
}
