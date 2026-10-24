/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { merge, type Subscription } from 'rxjs';
import { join } from 'path';
import { tr } from 'src/modules/i18n';
import { StudioEvents, studioDataDir } from 'src/modules/media-library';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { toDocumentDto, OcrStoreService } from './OcrStoreService';
import { EngineOcrClient, OcrEngineError } from './EngineOcrClient';
import type { OcrDocumentEntity } from '../entities/OcrDocumentEntity';
import type { OcrEvent } from '../types/ocrTypes';

const GATE_OWNER = 'ocr';
const WAIT_MS = 1500;

/** Folder of a reading's files, inside the data folder the engine also reads (it refuses any path outside). */
export const ocrDir = (id: string): string => join(studioDataDir(), 'ocr', id);

/**
 * Runs the readings one at a time: a reading waits while a media generation runs or the engine's gauge is held (a chat reply),
 * then holds the gauge for the length of its pages, so that nothing else asks the engine for a model meanwhile. The engine
 * decides what stays in memory next to the OCR model (`engine/app/memory_budget.py`). Progress and results are written page by
 * page, so a reading that stops half-way keeps what was read.
 */
@Injectable()
export class OcrQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrQueueService.name);
  private readonly waiting: string[] = [];
  private current: { id: string; abort: AbortController } | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly wake: Subscription;

  constructor(
    private readonly store: OcrStoreService,
    private readonly client: EngineOcrClient,
    private readonly gate: EngineBusyGate,
    private readonly generations: GenerationQueueService,
    private readonly events: StudioEvents,
  ) {
    // A reading that waits starts as soon as the gauge is released or the generations are done, not at the next poll.
    this.wake = merge(this.gate.released$, this.generations.idle$).subscribe(() => void this.pump());
  }

  onModuleDestroy(): void {
    this.closed = true;
    this.wake.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
    this.current?.abort.abort();
  }

  enqueue(id: string): void {
    if (!this.waiting.includes(id) && this.current?.id !== id) this.waiting.push(id);
    void this.pump();
  }

  /** Stops a reading: a waiting one leaves the line, the running one is cut at once (its pages so far are kept). */
  cancel(id: string): boolean {
    const at = this.waiting.indexOf(id);
    if (at >= 0) {
      this.waiting.splice(at, 1);
      return true;
    }
    if (this.current?.id === id) {
      this.current.abort.abort();
      return true;
    }
    return false;
  }

  isActive(id: string): boolean {
    return this.waiting.includes(id) || this.current?.id === id;
  }

  private async pump(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.waiting.length && !this.closed) {
        if (this.generations.occupied || !this.gate.tryAcquire(GATE_OWNER)) {
          this.timer = setTimeout(() => void this.pump(), WAIT_MS);
          this.timer.unref();
          return;
        }
        const id = this.waiting.shift() as string;
        try {
          await this.run(id);
        } finally {
          this.gate.release(GATE_OWNER);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string): Promise<void> {
    const doc = await this.store.get(id);
    if (!doc) return;
    const abort = new AbortController();
    this.current = { id, abort };
    await this.publish(id, { status: 'running', error: null });
    try {
      for await (const event of this.client.read(
        { model_id: doc.modelId, path: join(ocrDir(id), doc.sourceFile), task: doc.task, prompt: doc.prompt, pages: doc.pages },
        abort.signal,
      )) {
        if (await this.apply(doc, event)) break;
      }
    } catch (error) {
      await this.end(id, abort.signal.aborted ? 'cancelled' : 'failed', abort.signal.aborted ? null : this.describe(error));
    } finally {
      this.current = null;
    }
  }

  /** Applies one engine event; true once the reading is over. */
  private async apply(doc: OcrDocumentEntity, event: OcrEvent): Promise<boolean> {
    switch (event.type) {
      case 'pages':
        await this.publish(doc.id, { documentPages: event.document_pages, pagesTotal: event.total, pagesDone: 0 });
        return false;
      case 'page': {
        await this.store.savePage(doc.id, { index: event.index, text: event.text, truncated: event.truncated, tokens: event.usage?.completion_tokens ?? null });
        await this.publish(doc.id, { pagesDone: event.position });
        return false;
      }
      case 'done':
        await this.end(doc.id, 'done', null);
        return true;
      case 'error':
        await this.end(doc.id, 'failed', event.message);
        return true;
      default:
        return false;
    }
  }

  private describe(error: unknown): string {
    if (error instanceof OcrEngineError) return error.message;
    this.logger.warn(`OCR reading failed: ${error instanceof Error ? error.message : String(error)}`);
    return tr('ocr.error.unexpected');
  }

  private async end(id: string, status: 'done' | 'failed' | 'cancelled', error: string | null): Promise<void> {
    await this.publish(id, { status, error });
  }

  private async publish(id: string, patch: Partial<OcrDocumentEntity>): Promise<void> {
    const row = await this.store.update(id, patch);
    if (row) this.events.publish('ocr.updated', toDocumentDto(row));
  }
}
