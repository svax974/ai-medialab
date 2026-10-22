/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Response } from 'express';
import type { ReplySink } from '../services/ChatReplyService';

/** Pending bytes after which a client that does not read is dropped (as the template's event stream does). */
export const MAX_PENDING_BYTES = 1024 * 1024;
export const PING_MS = 15_000;

/**
 * The SSE response of a reply. The headers are sent with the first event, so a refusal thrown before it is still an
 * ordinary HTTP error. `no-transform` and `X-Accel-Buffering: no` keep the compression middleware and proxies from
 * holding the stream back. `signal` aborts when the client closes the connection before the end.
 */
export class SseStream implements ReplySink {
  private readonly controller = new AbortController();
  private begun = false;
  private ping: NodeJS.Timeout | null = null;

  /** `cacheControl`: what the response says about caching (the private chat says `no-store`). */
  constructor(private readonly res: Response, private readonly cacheControl = 'no-cache, no-transform') {
    res.on('close', () => {
      this.stopPing();
      if (!res.writableEnded) this.controller.abort();
    });
  }

  /** True once the headers were sent. */
  get started(): boolean {
    return this.begun;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Writes one event; ignored once the client has gone. */
  emit(event: string, data: unknown): void {
    if (this.res.destroyed || this.res.writableEnded) return;
    this.start();
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    this.flush();
    if (this.res.writableLength > MAX_PENDING_BYTES) {
      this.controller.abort();
      this.res.destroy();
    }
  }

  end(): void {
    this.stopPing();
    if (!this.begun) return;
    if (!this.res.writableEnded && !this.res.destroyed) this.res.end();
  }

  private start(): void {
    if (this.begun) return;
    this.begun = true;
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', this.cacheControl);
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.flushHeaders();
    this.ping = setInterval(() => {
      if (!this.res.destroyed && !this.res.writableEnded) {
        this.res.write(': ping\n\n');
        this.flush();
      }
    }, PING_MS);
    this.ping.unref();
  }

  private flush(): void {
    (this.res as Response & { flush?: () => void }).flush?.();
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }
}
