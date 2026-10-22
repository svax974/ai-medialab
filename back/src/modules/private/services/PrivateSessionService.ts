/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { nowSeconds } from 'src/modules/media-library';
import { DEFAULT_TTL_MINUTES, type PrivateSessionInfo } from '../types/privateTypes';
import {
  NEVER_INDEX, createSessionFolders, newSessionId, privateRoot, removeSession, removeSessionSync, sessionPath, setActiveSessionId, sweepPrivateRoot,
} from './privateFiles';
import { PrivateEvents } from './PrivateEvents';
import { PrivateStore } from './PrivateStore';

/** Called before the session folder goes: stop what runs in it (a generation) and wait until it let go of its files. */
export type WipeHook = () => Promise<void>;

/**
 * The private session: one at a time, in memory plus a random folder under `<data>/private`. It starts when the user
 * asks, ends when the user leaves, when the inactivity timeout runs out, when the server stops (best effort: on exit
 * and on SIGINT/SIGTERM) and, for what a crash leaves behind, when the server starts again (the folder of an earlier
 * run is removed: a session never survives a restart). It never writes a log line with content: counts only.
 */
@Injectable()
export class PrivateSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivateSessionService.name);
  private id: string | null = null;
  private createdAt: number | null = null;
  private lastActivity: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ending: Promise<void> | null = null;
  private readonly hooks: WipeHook[] = [];
  private readonly onExit = (): void => this.dropSync();
  private readonly signalHandlers: [NodeJS.Signals, () => void][] = [];

  constructor(
    private readonly store: PrivateStore,
    private readonly events: PrivateEvents,
  ) {}

  onModuleInit(): void {
    try {
      sweepPrivateRoot(); // no line about it: a journal that says a private session existed is itself a trace
      this.markNeverIndexed();
    } catch (error) {
      this.logger.warn(`private folder sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.end();
  }

  /** Registers what must stop before the folder is removed (the generation service). */
  onWipe(hook: WipeHook): void {
    this.hooks.push(hook);
  }

  get active(): boolean {
    return this.id !== null;
  }

  /** The folder id; 409-worthy when there is no session (callers check `active` first). */
  get sessionId(): string {
    if (!this.id) throw new Error('no private session');
    return this.id;
  }

  get dir(): string {
    return sessionPath(this.sessionId);
  }

  /** Starts a session (the current one is kept: starting twice is harmless). */
  start(): PrivateSessionInfo {
    if (!this.id) {
      this.id = newSessionId();
      this.createdAt = nowSeconds();
      createSessionFolders(this.id);
      writeFileSync(join(this.dir, NEVER_INDEX), '');
      this.store.bind(this.id);
      setActiveSessionId(this.id);
      this.attach();
      this.events.changed('session');
    }
    this.touch();
    return this.info();
  }

  /** Counts as activity: pushes the inactivity timeout back. */
  touch(): void {
    if (!this.id) return;
    this.lastActivity = nowSeconds();
    if (this.timer) clearTimeout(this.timer);
    const minutes = this.ttlMinutes();
    if (minutes > 0) {
      this.timer = setTimeout(() => void this.end(), minutes * 60_000);
      this.timer.unref();
    }
  }

  info(): PrivateSessionInfo {
    const minutes = this.ttlMinutes();
    const { conversations, results } = this.id ? this.store.counts() : { conversations: 0, results: 0 };
    return {
      active: this.id !== null,
      created_at: this.createdAt,
      last_activity: this.lastActivity,
      expires_at: this.id && minutes > 0 && this.lastActivity ? this.lastActivity + minutes * 60 : null,
      conversations,
      results,
    };
  }

  /** Ends the session: stops what runs, forgets everything, removes the folder. Idempotent; a second call waits for the first. */
  end(): Promise<void> {
    this.ending ??= this.doEnd().finally(() => { this.ending = null; });
    return this.ending;
  }

  private async doEnd(): Promise<void> {
    const id = this.id;
    if (!id) return;
    this.id = null;
    setActiveSessionId(null);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const hook of this.hooks) await hook().catch(() => undefined);
    this.store.clear();
    await removeSession(id);
    this.detach();
    this.createdAt = this.lastActivity = null;
    this.events.changed('session');
  }

  private ttlMinutes(): number {
    const raw = Number(process.env.PRIVATE_SESSION_TTL_MINUTES);
    return Number.isFinite(raw) && process.env.PRIVATE_SESSION_TTL_MINUTES ? raw : DEFAULT_TTL_MINUTES;
  }

  /** Last-moment removal (the process is going away): synchronous, no hook, no event. */
  private dropSync(): void {
    if (this.id) removeSessionSync(this.id);
  }

  /** The default action of a signal still happens: the listener only removes the folder, then re-raises it. */
  private attach(): void {
    process.once('exit', this.onExit);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = (): void => {
        this.dropSync();
        this.detach();
        process.kill(process.pid, signal);
      };
      this.signalHandlers.push([signal, handler]);
      process.once(signal, handler);
    }
  }

  private detach(): void {
    process.removeListener('exit', this.onExit);
    for (const [signal, handler] of this.signalHandlers.splice(0)) process.removeListener(signal, handler);
  }

  /**
   * Keeps Spotlight from indexing the private root, and asks Time Machine to skip it (macOS, best effort: a failure
   * only means the exclusion is not in place; the folder only exists while a session does).
   */
  private markNeverIndexed(): void {
    writeFileSync(join(privateRoot(), NEVER_INDEX), '');
    if (process.platform === 'darwin' && process.env.NODE_ENV !== 'test') {
      execFile('tmutil', ['addexclusion', privateRoot()], { timeout: 5000 }, () => undefined);
    }
  }
}
