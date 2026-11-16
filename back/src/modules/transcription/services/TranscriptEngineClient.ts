/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, EngineError, SseParser } from 'src/modules/engine';
import type { TranscriptEvent } from '../types/transcriptTypes';

export interface TranscriptReadRequest {
  model_id: string;
  folder: string;
  path: string | null;
  url: string | null;
  language: string | null;
}

/** Internal owned engine, not a third-party API: streaming and cancellation must not be throttled. */
@Injectable()
export class TranscriptEngineClient {
  constructor(private readonly engine: EngineClient) {}

  /** Liveness fallback when the event relay is disabled or still connecting at boot. */
  async ready(): Promise<boolean> {
    try { await this.engine.get('/engine/v1/status', { timeoutMs: 2000 }); return true; }
    catch { return false; }
  }

  async *read(body: TranscriptReadRequest, signal: AbortSignal): AsyncGenerator<TranscriptEvent> {
    const response = await fetch(this.engine.buildUrl('/engine/v1/transcripts/read'), {
      method: 'POST', headers: { ...this.engine.authHeaders(), Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new EngineError(response.status, '/engine/v1/transcripts/read', payload?.detail);
    }
    const reader = response.body.getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          const event = JSON.parse(frame.data) as TranscriptEvent;
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
    } finally { await reader.cancel().catch(() => undefined); }
  }

  async stop(): Promise<void> {
    await this.engine.post('/engine/v1/transcripts/stop');
  }
}
