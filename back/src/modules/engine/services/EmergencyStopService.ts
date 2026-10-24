/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger } from '@nestjs/common';

type StopHandler = () => Promise<unknown>;

/**
 * Lets the queues of the application learn about the emergency stop without importing each other: the generation queue and the OCR
 * queue register what they do on a stop (empty their waiting line), `announce()` runs them all and waits, and only then is the engine
 * asked to kill its model processes, so that no waiting job starts again in between.
 */
@Injectable()
export class EmergencyStopService {
  private readonly logger = new Logger(EmergencyStopService.name);
  private readonly handlers = new Set<StopHandler>();

  /** Registers what a queue does when everything is stopped; returns how to unregister. */
  onStop(handler: StopHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Runs every handler (a failing one is logged, never stops the others). */
  async announce(): Promise<void> {
    const results = await Promise.allSettled([...this.handlers].map((handler) => handler()));
    for (const result of results) {
      if (result.status === 'rejected') this.logger.warn(`emergency stop handler failed: ${String(result.reason)}`);
    }
  }
}
