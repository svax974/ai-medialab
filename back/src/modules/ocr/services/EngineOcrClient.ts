/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, EngineUnavailableError, SseParser } from 'src/modules/engine';
import type { OcrEvent, OcrTask } from '../types/ocrTypes';

/** A refusal of the engine before the first byte of the stream (unknown model, unreadable file, busy engine...) or an unreachable engine. */
export class OcrEngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface OcrReadRequest {
  model_id: string;
  /** Absolute path of an image or a PDF inside the data folder. */
  path: string;
  task: OcrTask;
  prompt?: string | null;
  pages?: number[] | null;
}

const detailOf = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    return parsed.detail === undefined ? text : JSON.stringify(parsed.detail);
  } catch {
    return text;
  }
};

/**
 * Streaming client of the engine's reading route (`POST /engine/v1/ocr/read`). `EngineClient` reads whole JSON answers; a reading is
 * a server-sent event stream that lasts as long as the pages take, so it has its own `fetch` (same URL and shared secret, no
 * timeout, cancelled by the caller's `AbortSignal`: aborting stops the reading in the engine and leaves the model loaded).
 */
@Injectable()
export class EngineOcrClient {
  constructor(private readonly engine: EngineClient) {}

  /** Yields the events of one reading, the last being `done` or `error`. Refusals before the stream throw an `OcrEngineError`. */
  async *read(body: OcrReadRequest, signal?: AbortSignal): AsyncGenerator<OcrEvent> {
    const path = '/engine/v1/ocr/read';
    let res: Response;
    try {
      res = await fetch(this.engine.buildUrl(path), {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...this.engine.authHeaders() },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new OcrEngineError(502, new EngineUnavailableError(path, error).message);
    }
    if (!res.ok || !res.body) throw new OcrEngineError(res.status, detailOf(await res.text().catch(() => '')));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          const event = this.parse(frame.data);
          if (!event) continue;
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    yield { type: 'error', code: 'closed', message: 'The engine closed the stream before the end of the reading.' };
  }

  private parse(data: string): OcrEvent | null {
    try {
      const event = JSON.parse(data) as { type?: unknown };
      return typeof event.type === 'string' ? (event as OcrEvent) : null;
    } catch {
      return null;
    }
  }
}
