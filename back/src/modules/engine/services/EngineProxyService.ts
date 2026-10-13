/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import type { Request, Response } from 'express';
import { ENGINE_API_PREFIX, ENGINE_CONFIG, ENGINE_TOKEN_HEADER, type EngineConfig } from '../engineConfig';

/**
 * TRANSITIONAL (removed in H6): first path segments of `/api/*` that Nest does not serve yet and relays to the engine.
 * A test checks that this list covers every first segment of `engine/openapi.json`.
 */
export const PROXIED_SEGMENTS = [
  'assets',
  'conversations',
  'events',
  'messages',
  'voices',
] as const;

/**
 * First segments of the engine API that Nest serves itself (a module takes the route over, the proxy no longer relays it)
 * or that only Nest may call (`runtime`). Together with `PROXIED_SEGMENTS` they cover `engine/openapi.json`.
 */
export const NEST_SERVED_SEGMENTS = ['engine', 'engines', 'hf', 'models', 'runtime', 'settings', 'status', 'system'] as const;

/** `/api/media/<kind>/<file>` -> the engine's static media mounts (`/media/...`, no token). */
export const MEDIA_SEGMENT = 'media';

const API_PREFIX = '/api';
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'content-length', 'range', 'if-none-match', 'if-modified-since'];
const DROPPED_RESPONSE_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'content-length'];

/** Maps a browser URL (`/api/models?x=1`) to the engine URL path (`/engine/v1/models?x=1`); null when not proxied. */
export function toEnginePath(originalUrl: string): string | null {
  if (!originalUrl.startsWith(`${API_PREFIX}/`)) return null;
  const rest = originalUrl.slice(API_PREFIX.length);
  const segment = rest.split(/[/?]/)[1] ?? '';
  if (segment === MEDIA_SEGMENT) return rest;
  return (PROXIED_SEGMENTS as readonly string[]).includes(segment) ? `${ENGINE_API_PREFIX}${rest}` : null;
}

/**
 * Streams a browser request to the engine and the answer back (JSON, multipart uploads, SSE, media with ranges).
 * The Nest auth already ran: the bearer token never reaches the engine, which only gets `X-Engine-Token`.
 */
@Injectable()
export class EngineProxyService {
  private readonly logger = new Logger(EngineProxyService.name);

  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  forward(req: Request, res: Response, enginePath: string): void {
    const target = new URL(this.config.url + enginePath);
    const isMedia = enginePath.startsWith('/media/');
    const headers = this.requestHeaders(req, !isMedia);
    const body = this.jsonBody(req);
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (up) => this.relayResponse(up, res),
    );
    upstream.on('error', (err) => this.fail(res, err));
    res.on('close', () => upstream.destroy());
    if (body !== undefined) upstream.end(body);
    else req.pipe(upstream);
  }

  private requestHeaders(req: Request, withToken: boolean): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    for (const name of FORWARDED_REQUEST_HEADERS) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    if (withToken && this.config.token) headers[ENGINE_TOKEN_HEADER.toLowerCase()] = this.config.token;
    return headers;
  }

  /**
   * A JSON body was consumed by the Nest body parser: serialise it again, minus the `uid`/`user` members the global
   * auth interceptor mirrors into it. Other bodies (multipart, none) are piped untouched.
   */
  private jsonBody(req: Request): string | undefined {
    const type = req.headers['content-type'] ?? '';
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (!hasBody || !type.includes('json') || typeof req.body !== 'object' || req.body === null) return undefined;
    const copy = { ...(req.body as Record<string, unknown>) };
    const injected = (req as Request & { user?: unknown }).user;
    if (injected !== undefined && copy['user'] === injected) {
      delete copy['uid'];
      delete copy['user'];
    }
    return JSON.stringify(copy);
  }

  private relayResponse(up: http.IncomingMessage, res: Response): void {
    const headers = { ...up.headers };
    for (const name of DROPPED_RESPONSE_HEADERS) delete headers[name];
    if ((up.headers['content-type'] ?? '').includes('text/event-stream')) {
      // Same rule as Nest's own SSE: no compression, no proxy buffering.
      headers['cache-control'] = 'no-cache, no-transform';
      headers['x-accel-buffering'] = 'no';
    }
    res.writeHead(up.statusCode ?? 502, headers);
    up.pipe(res);
    res.on('close', () => up.destroy());
  }

  private fail(res: Response, err: Error): void {
    this.logger.warn(`engine proxy: ${err.message}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).json({ statusCode: 502, message: 'Engine unavailable' });
  }
}
