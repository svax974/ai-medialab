/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { EventStreamService } from 'src/modules_shared/common/event-stream';
import { TOPIC_PATTERN } from 'src/modules_shared/common/event-stream/constants';
import { ENGINE_CONFIG, type EngineConfig } from '../engineConfig';
import { EngineClient } from './EngineClient';
import { SseParser } from './sseParser';

/** An event of the engine stream, as received (`name` is the SSE `event:` field, e.g. `job.progress`). */
export interface EngineEvent {
  name: string;
  data: unknown;
}

/** Topic carrying the engine connection state (`{ connected }`). */
export const ENGINE_LINK_TOPIC = 'engine.link';

/** Single-user app: every principal that can read the stream is an admin (`local-trust` included). */
const AUDIENCE = { admin: true } as const;

/**
 * Subscribes to the engine event stream (`/engine/v1/events`) with reconnection (exponential backoff with jitter,
 * idle watchdog) and relays each event to the browser through `EventStreamService` under the topic
 * `engine.<event name>` (`engine.job.progress`, `engine.models.changed`, ...), audience `admin`. Server-side code
 * can also observe them with `events$`. `engine.link` reports whether the stream is connected.
 */
@Injectable()
export class EngineEventRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineEventRelay.name);
  private readonly subject = new Subject<EngineEvent>();
  private controller: AbortController | null = null;
  private wake: (() => void) | null = null;
  private stopped = true;
  private link = false;

  constructor(
    private readonly client: EngineClient,
    private readonly stream: EventStreamService,
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
  ) {}

  /** Every event received from the engine, in order. */
  get events$(): Observable<EngineEvent> {
    return this.subject.asObservable();
  }

  /** True while the engine stream is open. */
  get connected(): boolean {
    return this.link;
  }

  onModuleInit(): void {
    if (this.config.relayEvents) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.wake?.();
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const opened = await this.consume();
        if (opened) attempt = 0;
      } catch (err) {
        if (!this.stopped) {
          // A down engine is retried for as long as it takes: log the first failure of a streak, not every retry.
          const log = attempt === 0 ? this.logger.warn : this.logger.debug;
          log.call(this.logger, `engine stream lost: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.setLink(false);
      if (this.stopped) return;
      await this.sleep(this.backoff(attempt++));
    }
  }

  /** Delay before reconnection `attempt` (0-based): min * 2^attempt capped at max, +-20 % jitter. */
  backoff(attempt: number): number {
    const base = Math.min(this.config.reconnectMinMs * 2 ** attempt, this.config.reconnectMaxMs);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  /** One connection; resolves true when the stream was opened (so the backoff resets), false otherwise. */
  private async consume(): Promise<boolean> {
    const controller = new AbortController();
    this.controller = controller;
    let idle: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), this.config.idleTimeoutMs);
    };
    try {
      arm();
      const res = await this.client.openEventStream(controller.signal);
      this.setLink(true);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return true;
        arm();
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) this.dispatch(frame.event, frame.data);
      }
    } finally {
      clearTimeout(idle);
      controller.abort();
    }
  }

  private dispatch(name: string, raw: string): void {
    const topic = `engine.${name}`;
    if (!TOPIC_PATTERN.test(topic)) {
      this.logger.warn(`engine event ignored (invalid name): ${name}`);
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      this.logger.warn(`engine event ignored (invalid JSON): ${name}`);
      return;
    }
    this.subject.next({ name, data });
    this.stream.publish(topic, { type: name, data: data as Record<string, unknown> }, AUDIENCE);
  }

  private setLink(connected: boolean): void {
    if (this.link === connected) return;
    this.link = connected;
    this.stream.publish(ENGINE_LINK_TOPIC, { type: 'link', data: { connected } }, AUDIENCE);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }
}
