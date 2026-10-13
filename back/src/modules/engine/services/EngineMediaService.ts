/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import type { Request, Response } from 'express';
import { ENGINE_CONFIG, type EngineConfig } from '../engineConfig';

const MEDIA_PREFIX = '/api/media/';
const FORWARDED_REQUEST_HEADERS = ['accept', 'range', 'if-none-match', 'if-modified-since'];
const DROPPED_RESPONSE_HEADERS = ['connection', 'keep-alive', 'transfer-encoding'];

/** Maps a browser URL (`/api/media/outputs/a.png?x=1`) to the engine's static mount (`/media/outputs/a.png?x=1`); null otherwise. */
export function toEngineMediaPath(originalUrl: string): string | null {
  if (!originalUrl.startsWith(MEDIA_PREFIX)) return null;
  const rest = originalUrl.slice(MEDIA_PREFIX.length - 1);
  return rest.length > '/'.length ? `/media${rest}` : null;
}

/**
 * Streams a media file from the engine to the browser, with `Range` support (audio and video seeking). The engine's
 * media mounts take no token (they are read-only files on a loopback port); the bearer token of the browser is never
 * forwarded.
 */
@Injectable()
export class EngineMediaService {
  private readonly logger = new Logger(EngineMediaService.name);

  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  forward(req: Request, res: Response, enginePath: string): void {
    const target = new URL(this.config.url + enginePath);
    const headers: http.OutgoingHttpHeaders = {};
    for (const name of FORWARDED_REQUEST_HEADERS) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (up) => this.relayResponse(up, res),
    );
    upstream.on('error', (err) => this.fail(res, err));
    res.on('close', () => upstream.destroy());
    upstream.end();
  }

  private relayResponse(up: http.IncomingMessage, res: Response): void {
    const headers = { ...up.headers };
    for (const name of DROPPED_RESPONSE_HEADERS) delete headers[name];
    res.writeHead(up.statusCode ?? 502, headers);
    up.pipe(res);
    res.on('close', () => up.destroy());
  }

  private fail(res: Response, err: Error): void {
    this.logger.warn(`engine media: ${err.message}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).json({ statusCode: 502, message: 'Engine unavailable' });
  }
}
