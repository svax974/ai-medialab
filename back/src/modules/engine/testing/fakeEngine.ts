/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** A local HTTP server standing in for the Python engine in tests (records requests, scripted answers). */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { ENGINE_TOKEN_HEADER, type EngineConfig } from '../engineConfig';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export type FakeHandler = (req: RecordedRequest, res: http.ServerResponse) => void;

export interface FakeEngine {
  url: string;
  requests: RecordedRequest[];
  /** Replaces the handler (default: 200 `{ ok: true }`). */
  handle(handler: FakeHandler): void;
  /** Open SSE responses of `/engine/v1/events`, in order of connection. */
  streams: http.ServerResponse[];
  close(): Promise<void>;
}

export const TEST_TOKEN = 'test-engine-token';

export function testConfig(url: string, overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    url,
    token: TEST_TOKEN,
    timeoutMs: 2_000,
    relayEvents: true,
    reconnectMinMs: 20,
    reconnectMaxMs: 60,
    idleTimeoutMs: 5_000,
    ...overrides,
  };
}

export async function startFakeEngine(): Promise<FakeEngine> {
  const requests: RecordedRequest[] = [];
  const streams: http.ServerResponse[] = [];
  let handler: FakeHandler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rec: RecordedRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(rec);
      if (rec.url === '/engine/v1/events' && rec.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('retry: 2000\n\n');
        streams.push(res);
        return;
      }
      handler(rec, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    streams,
    handle: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        streams.forEach((s) => s.destroy());
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export { ENGINE_TOKEN_HEADER };
