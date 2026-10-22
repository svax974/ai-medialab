/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { SseParser } from './sseParser';

describe('SseParser', () => {
  it('parses event and data frames, ignoring comments and retry', () => {
    const parser = new SseParser();
    const frames = parser.push('retry: 2000\n\nevent: engine.status\ndata: {"a":1}\n\n: ping\n\n');
    expect(frames).toEqual([{ event: 'engine.status', data: '{"a":1}' }]);
  });

  it('reassembles a frame split across chunks and handles CRLF', () => {
    const parser = new SseParser();
    expect(parser.push('event: job.progress\r\nda')).toEqual([]);
    expect(parser.push('ta: {"p":0.5}\r\n\r\n')).toEqual([{ event: 'job.progress', data: '{"p":0.5}' }]);
  });

  it('joins multi-line data and defaults the event name to "message"', () => {
    const parser = new SseParser();
    expect(parser.push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});
