/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Minimal incremental parser of a Server-Sent Events stream (the engine sends `event:` + `data:` frames). */

export interface SseFrame {
  /** `event:` field; `message` when absent (SSE default). */
  event: string;
  /** `data:` lines joined with `\n`. */
  data: string;
}

export class SseParser {
  private buffer = '';

  /** Feeds a decoded chunk; returns the frames completed by it. Comments (`: ping`), `retry:` and `id:` are ignored. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const frame = this.parseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private parseBlock(block: string): SseFrame | null {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
  }
}
