/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { AssetFileService, StudioEvents } from 'src/modules/media-library';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';
import { EngineBusyGate } from './EngineBusyGate';
import { GenerationQueueService } from './GenerationQueueService';
import { JobRequestBuilder } from './JobRequestBuilder';

describe('EngineBusyGate', () => {
  it('is held by one owner at a time and released only by its owner', () => {
    const gate = new EngineBusyGate();
    expect(gate.busy).toBe(false);
    expect(gate.tryAcquire('chat')).toBe(true);
    expect(gate.busy).toBe(true);
    expect(gate.heldBy).toBe('chat');
    expect(gate.tryAcquire('chat')).toBe(false);
    expect(gate.tryAcquire('other')).toBe(false);
    gate.release('other'); // a late release by someone else changes nothing
    expect(gate.busy).toBe(true);
    gate.release('chat');
    expect(gate.busy).toBe(false);
    expect(gate.tryAcquire('other')).toBe(true);
  });

  it('tells its subscribers when it is released, once per release', () => {
    const gate = new EngineBusyGate();
    let released = 0;
    gate.released$.subscribe(() => released++);
    gate.release('chat'); // nothing held: no signal
    gate.tryAcquire('chat');
    gate.release('chat');
    expect(released).toBe(1);
  });
});

describe('EngineBusyGate preemption', () => {
  it('lets a holder that offered to yield be asked to let go, and resolves when it did', async () => {
    const gate = new EngineBusyGate();
    gate.tryAcquire('chat');
    expect(gate.preemptible).toBe(false);
    gate.setYield('other', () => undefined); // not the holder: ignored
    expect(gate.preemptible).toBe(false);
    let asked = 0;
    gate.setYield('chat', () => {
      asked++;
      setTimeout(() => gate.release('chat'), 5);
    });
    expect(gate.preemptible).toBe(true);
    await gate.preempt();
    expect(asked).toBe(1);
    expect(gate.busy).toBe(false);
    expect(gate.preemptible).toBe(false); // the offer ends with the hold
  });

  it('does not wait for a holder that did not offer, nor when nobody holds the gauge', async () => {
    const gate = new EngineBusyGate();
    await gate.preempt();
    gate.tryAcquire('chat');
    await gate.preempt(); // returns at once; the caller meets `busy` through tryAcquire
    expect(gate.busy).toBe(true);
    gate.setYield('chat', () => undefined);
    gate.setYield('chat', null); // the offer taken back
    expect(gate.preemptible).toBe(false);
  });
});

describe('the generation queue and the chat gauge', () => {
  let dataSource: DataSource;
  let s: Studio;
  let gate: EngineBusyGate;
  let queue: GenerationQueueService;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    gate = new EngineBusyGate();
    queue = new GenerationQueueService(
      s.messages, s.assets, s.files as AssetFileService, new JobRequestBuilder(s.messages, s.voices), s.client as never, s.relay as never, s.events as StudioEvents, gate,
    );
    await s.conversations.create({ title: 'c' }).then((c) => dataSource.query("UPDATE conversations SET id = 'c1' WHERE id = ?", [c.id]));
    await s.messages.create({ id: 'u1', conversationId: 'c1', role: 'user', prompt: 'p' });
    await queue.onApplicationBootstrap();
  });
  afterEach(async () => {
    queue.onModuleDestroy();
    await dataSource.destroy();
  });

  const enqueue = async (id: string) => {
    await s.messages.create({ id, conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'p', modelId: 'demo', params: { seeds: [1] }, status: 'queued' });
    queue.enqueue({ id, conversationId: 'c1' }, 'image');
    await queue.idle();
  };

  it('submits nothing while a chat reply holds the engine, and goes on when it ends', async () => {
    gate.tryAcquire('chat');
    await enqueue('a1');
    expect(s.engine.submitted()).toEqual([]); // the engine would answer 409
    expect(queue.snapshot()).toEqual({ current: null, pending: ['a1'] });
    expect(queue.occupied).toBe(true); // the chat sees it too
    gate.release('chat');
    await queue.idle();
    expect(s.engine.submitted()).toEqual(['a1']);
    expect(queue.snapshot()).toEqual({ current: 'a1', pending: [] });
  });

  it('keeps the order of several waiting messages across a chat reply', async () => {
    gate.tryAcquire('chat');
    await enqueue('a1');
    await enqueue('a2');
    gate.release('chat');
    await queue.idle();
    expect(s.engine.submitted()).toEqual(['a1']); // one at a time, as before
    expect(queue.snapshot().pending).toEqual(['a2']);
  });

  it('asks a chat title being written to give the engine up, then submits', async () => {
    gate.tryAcquire('chat');
    let asked = 0;
    gate.setYield('chat', () => {
      asked++;
      setTimeout(() => gate.release('chat'), 5); // the title request is cancelled, the reply service lets go
    });
    await enqueue('a1');
    expect(asked).toBeGreaterThan(0);
    for (let i = 0; i < 40 && !s.engine.submitted().length; i++) await new Promise((r) => setTimeout(r, 10));
    await queue.idle();
    expect(s.engine.submitted()).toEqual(['a1']);
    expect(gate.busy).toBe(false);
  });

  it('does not ask a holder that did not offer to yield (a reply being written)', async () => {
    gate.tryAcquire('chat');
    await enqueue('a1');
    expect(s.engine.submitted()).toEqual([]);
    expect(gate.busy).toBe(true);
  });

  it('is not occupied when nothing runs or waits', () => {
    expect(queue.occupied).toBe(false);
  });

  it('works without a gauge (a wiring without the chat)', async () => {
    const plain = new GenerationQueueService(
      s.messages, s.assets, s.files as AssetFileService, new JobRequestBuilder(s.messages, s.voices), s.client as never, s.relay as never, s.events as StudioEvents,
    );
    await plain.onApplicationBootstrap();
    await s.messages.create({ id: 'a9', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'p', modelId: 'demo', params: { seeds: [1] }, status: 'queued' });
    plain.enqueue({ id: 'a9', conversationId: 'c1' }, 'image');
    await plain.idle();
    expect(s.engine.submitted()).toEqual(['a9']);
    plain.onModuleDestroy();
  });
});
