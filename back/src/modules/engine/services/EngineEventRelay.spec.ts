/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EventStreamService } from 'src/modules_shared/common/event-stream';
import { startFakeEngine, testConfig, type FakeEngine } from '../testing/fakeEngine';
import { EngineClient } from './EngineClient';
import { EngineEvent, EngineEventRelay, ENGINE_LINK_TOPIC } from './EngineEventRelay';

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('EngineEventRelay', () => {
  let engine: FakeEngine;
  let publish: jest.Mock;
  let relay: EngineEventRelay;
  const make = (overrides = {}) => {
    const config = testConfig(engine.url, overrides);
    relay = new EngineEventRelay(new EngineClient(config), { publish } as unknown as EventStreamService, config);
    return relay;
  };
  const topics = () => publish.mock.calls.map((c) => c[0]);

  beforeEach(async () => {
    engine = await startFakeEngine();
    publish = jest.fn();
  });
  afterEach(async () => {
    relay?.stop();
    await engine.close();
  });

  it('relays engine events to the admin audience under engine.<name> and to events$', async () => {
    const seen: EngineEvent[] = [];
    make().events$.subscribe((e) => seen.push(e));
    relay.start();
    await until(() => engine.streams.length === 1);
    engine.streams[0].write('event: job.progress\ndata: {"message_id":"m1","progress":0.5}\n\n: ping\n\n');
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual({ name: 'job.progress', data: { message_id: 'm1', progress: 0.5 } });
    expect(publish).toHaveBeenCalledWith(
      'engine.job.progress',
      { type: 'job.progress', data: { message_id: 'm1', progress: 0.5 } },
      { admin: true },
    );
    expect(engine.requests[0].headers['x-engine-token']).toBe('test-engine-token');
  });

  it('emits link changes on linkChanges$ (true at each (re)connection)', async () => {
    const changes: boolean[] = [];
    make().linkChanges$.subscribe((c) => changes.push(c));
    relay.start();
    await until(() => relay.connected);
    engine.streams[0].end();
    await until(() => engine.streams.length === 2 && relay.connected);
    expect(changes).toEqual([true, false, true]);
  });

  it('reports the link state and reconnects after the engine closes the stream', async () => {
    make();
    relay.start();
    await until(() => relay.connected);
    expect(publish).toHaveBeenCalledWith(ENGINE_LINK_TOPIC, { type: 'link', data: { connected: true } }, { admin: true });
    engine.streams[0].end();
    await until(() => !relay.connected);
    await until(() => engine.streams.length === 2 && relay.connected);
    expect(publish.mock.calls.filter((c) => c[0] === ENGINE_LINK_TOPIC).map((c) => (c[1] as { data: { connected: boolean } }).data.connected)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('keeps retrying while the engine is down, then connects', async () => {
    const url = engine.url;
    await engine.close();
    make();
    relay.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(relay.connected).toBe(false);
    const port = Number(new URL(url).port);
    const http = await import('http');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: engine.status\ndata: {"state":"idle"}\n\n');
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    try {
      await until(() => topics().includes('engine.engine.status'));
      expect(relay.connected).toBe(true);
    } finally {
      relay.stop();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      engine = await startFakeEngine();
    }
  });

  it('drops a connection that stays silent past the idle timeout and reconnects', async () => {
    make({ idleTimeoutMs: 80 });
    relay.start();
    await until(() => engine.streams.length === 2, 3_000);
  });

  it('ignores invalid JSON and invalid event names', async () => {
    make().start();
    await until(() => engine.streams.length === 1);
    engine.streams[0].write('event: job.progress\ndata: {oops\n\nevent: bad name!\ndata: {}\n\nevent: ok.event\ndata: {}\n\n');
    await until(() => topics().includes('engine.ok.event'));
    expect(topics()).not.toContain('engine.job.progress');
    expect(topics().some((t) => String(t).includes('bad'))).toBe(false);
  });

  it('stops without reconnecting', async () => {
    make();
    relay.start();
    await until(() => relay.connected);
    relay.stop();
    await until(() => !relay.connected);
    await new Promise((r) => setTimeout(r, 150));
    expect(engine.streams).toHaveLength(1);
  });

  it('backoff doubles up to the cap, with bounded jitter', () => {
    make({ reconnectMinMs: 100, reconnectMaxMs: 800 });
    for (const [attempt, base] of [[0, 100], [1, 200], [3, 800], [9, 800]]) {
      const d = relay.backoff(attempt);
      expect(d).toBeGreaterThanOrEqual(base * 0.8);
      expect(d).toBeLessThanOrEqual(base * 1.2);
    }
  });

  it('does not start from onModuleInit when relayEvents is false', async () => {
    make({ relayEvents: false });
    relay.onModuleInit();
    await new Promise((r) => setTimeout(r, 100));
    expect(engine.streams).toHaveLength(0);
  });
});
