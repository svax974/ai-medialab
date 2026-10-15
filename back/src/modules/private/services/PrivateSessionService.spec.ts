/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrivateEvents } from './PrivateEvents';
import { PrivateSessionService } from './PrivateSessionService';
import { PrivateStore } from './PrivateStore';
import { activeSessionId, NEVER_INDEX, privateRoot } from './privateFiles';

describe('PrivateSessionService', () => {
  let store: PrivateStore;
  let session: PrivateSessionService;
  let told: unknown[];

  beforeEach(() => {
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), 'private-session-'));
    delete process.env.PRIVATE_SESSION_TTL_MINUTES;
    told = [];
    store = new PrivateStore();
    session = new PrivateSessionService(store, new PrivateEvents({ publish: (_t: string, e: unknown) => told.push(e) } as never));
  });
  afterEach(async () => {
    jest.useRealTimers();
    await session.end();
  });

  it('starts with a random folder only the user can read, kept out of Spotlight, with its subfolders', () => {
    const info = session.start();
    expect(info).toMatchObject({ active: true, conversations: 0, results: 0 });
    expect(session.sessionId).toMatch(/^[A-Za-z0-9_-]{16,64}$/); // what the engine accepts
    expect(readdirSync(session.dir).sort()).toEqual([NEVER_INDEX, 'inputs', 'outputs', 'previews', 'thumbs', 'tmp']);
    expect(statSync(session.dir).mode & 0o077).toBe(0);
    expect(activeSessionId()).toBe(session.sessionId);
  });

  it('starting twice keeps the same session', () => {
    const first = session.start();
    expect(session.start().created_at).toBe(first.created_at);
  });

  it('ending removes the folder and forgets everything, and is harmless when repeated', async () => {
    session.start();
    store.createConversation({ title: 'x', mode: 'image' });
    const dir = session.dir;
    writeFileSync(join(dir, 'outputs', 'a.png'), 'x');
    await session.end();
    await session.end();
    expect(existsSync(dir)).toBe(false);
    expect(store.counts()).toEqual({ conversations: 0, results: 0 });
    expect(activeSessionId()).toBeNull();
    expect(session.info()).toMatchObject({ active: false, created_at: null, expires_at: null });
  });

  it('a session never survives a restart: the folders an earlier run left are removed when the module starts', () => {
    const root = privateRoot();
    mkdirSync(join(root, 'old-session', 'outputs'), { recursive: true });
    writeFileSync(join(root, 'old-session', 'outputs', 'leftover.png'), 'x');
    session.onModuleInit();
    expect(readdirSync(root)).toEqual([NEVER_INDEX]);
  });

  it('erases itself after the inactivity timeout, and any request pushes it back', () => {
    process.env.PRIVATE_SESSION_TTL_MINUTES = '10';
    jest.useFakeTimers();
    session.start();
    jest.advanceTimersByTime(9 * 60_000);
    session.touch();
    jest.advanceTimersByTime(9 * 60_000);
    expect(session.active).toBe(true);
    jest.advanceTimersByTime(2 * 60_000);
    expect(session.active).toBe(false);
  });

  it('a timeout of 0 never erases it', () => {
    process.env.PRIVATE_SESSION_TTL_MINUTES = '0';
    jest.useFakeTimers();
    session.start();
    jest.advanceTimersByTime(24 * 3_600_000);
    expect(session.active).toBe(true);
    expect(session.info().expires_at).toBeNull();
  });

  it('removes its folder when the process exits, and leaves no listener behind once it ended', async () => {
    const exits = process.listenerCount('exit');
    const signals = process.listenerCount('SIGTERM');
    session.start();
    expect(process.listenerCount('exit')).toBe(exits + 1);
    expect(process.listenerCount('SIGTERM')).toBe(signals + 1);
    const dir = session.dir;
    process.listeners('exit').at(-1)?.call(process, 0); // what the process does last
    expect(existsSync(dir)).toBe(false);
    await session.end();
    expect(process.listenerCount('exit')).toBe(exits);
    expect(process.listenerCount('SIGTERM')).toBe(signals);
  });

  it('tells the browser about its start and its end with no content', async () => {
    session.start();
    await session.end();
    expect(JSON.stringify(told)).toBe(JSON.stringify([
      { type: 'private.changed', data: { kind: 'session' } }, { type: 'private.changed', data: { kind: 'session' } },
    ]));
  });

  it('runs the hooks before it removes the folder', async () => {
    session.start();
    const dir = session.dir;
    let existedDuringHook = false;
    session.onWipe(async () => { existedDuringHook = existsSync(dir); });
    await session.end();
    expect(existedDuringHook).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });
});
