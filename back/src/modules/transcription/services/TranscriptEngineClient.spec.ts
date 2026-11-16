/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { afterEach, expect, it, jest } from '@jest/globals';
import { TranscriptEngineClient } from './TranscriptEngineClient';

const engine = { buildUrl: (path: string) => `http://engine.test${path}`, authHeaders: () => ({ 'X-Engine-Token': 'FAKE-token' }), post: jest.fn(), get: jest.fn<() => Promise<object>>() };
const client = new TranscriptEngineClient(engine as never);
const request = { model_id: 'whisper', folder: '/data/job', path: '/data/job/source.mp4', url: null, language: null };
afterEach(() => jest.restoreAllMocks());

it('reads fragmented UTF-8 SSE, ignores heartbeats and closes its reader on terminal output', async () => {
  const payload = new TextEncoder().encode(': keepalive\n\ndata: {"type":"segment","index":0,"text":"été","language":"fr","done":60}\n\ndata: {"type":"done"}\n\n');
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(payload.slice(0, 65)); controller.enqueue(payload.slice(65)); }, cancel() { cancelled = true; } });
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
  const output = [];
  for await (const event of client.read(request, new AbortController().signal)) output.push(event);
  expect(output).toMatchObject([{ type: 'segment', text: 'été' }, { type: 'done' }]);
  expect(cancelled).toBe(true);
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'X-Engine-Token': 'FAKE-token' });
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(request);
});

it('preserves structured engine validation errors and sends an acknowledged stop', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: [{ msg: 'invalid language' }] }), { status: 422 }));
  await expect(async () => { for await (const _event of client.read(request, new AbortController().signal)) { /* no event */ } }).rejects.toThrow('invalid language');
  await client.stop();
  expect(engine.post).toHaveBeenCalledWith('/engine/v1/transcripts/stop');
});

it('checks lightweight liveness when the relay is unavailable', async () => {
  engine.get.mockResolvedValueOnce({ ok: true });
  expect(await client.ready()).toBe(true);
  engine.get.mockRejectedValueOnce(new Error('offline'));
  expect(await client.ready()).toBe(false);
});
