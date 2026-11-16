/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join } from 'path';
import { readdir, rm } from 'fs/promises';
import { merge, Subscription } from 'rxjs';
import { EmergencyStopService, EngineEventRelay } from 'src/modules/engine';
import { tr } from 'src/modules/i18n';
import { StudioEvents, studioDataDir } from 'src/modules/media-library';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { vtrace } from 'src/modules_shared/common/validation';
import { TranscriptEntity } from '../entities/TranscriptEntity';
import type { TranscriptEvent, TranscriptStatus } from '../types/transcriptTypes';
import { TranscriptEngineClient } from './TranscriptEngineClient';
import { TranscriptStore, transcriptDto } from './TranscriptStore';

export const transcriptDir = (id: string): string => join(studioDataDir(), 'transcripts', id);
const OWNER = 'transcription';

@Injectable()
export class TranscriptQueue implements OnModuleDestroy {
  private readonly logger = new Logger(TranscriptQueue.name);
  private waiting: string[] = [];
  private current: { id: string; abort: AbortController; finished: Promise<void> } | null = null;
  private running = false;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly wake: Subscription;
  private readonly detachEmergency: () => void;

  constructor(private readonly store: TranscriptStore, private readonly client: TranscriptEngineClient,
    private readonly gate: EngineBusyGate, private readonly generations: GenerationQueueService,
    private readonly events: StudioEvents, emergency: EmergencyStopService, private readonly relay: EngineEventRelay) {
    this.wake = merge(gate.released$, generations.idle$, relay.linkChanges$).subscribe(() => void this.pump());
    this.detachEmergency = emergency.onStop(() => this.cancelAll());
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    this.wake.unsubscribe();
    this.detachEmergency();
    if (this.timer) clearTimeout(this.timer);
    this.current?.abort.abort();
    await this.current?.finished;
  }

  enqueue(id: string): void {
    if (!this.isActive(id)) this.waiting.push(id);
    void this.pump();
  }

  isActive(id: string): boolean { return this.waiting.includes(id) || this.current?.id === id; }

  async cancel(id: string): Promise<void> {
    if (this.current?.id === id) {
      this.current.abort.abort();
      await this.current.finished;
    } else if (this.waiting.includes(id)) {
      this.waiting = this.waiting.filter((value) => value !== id);
      await this.finish(id, 'cancelled');
    }
  }

  async cancelAll(): Promise<number> {
    const queued = this.waiting;
    this.waiting = [];
    const current = this.current;
    current?.abort.abort();
    for (const id of queued) await this.finish(id, 'cancelled');
    await current?.finished;
    return queued.length + (current ? 1 : 0);
  }

  private async pump(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.waiting.length && !this.closed) {
        const ready = this.relay.connected || await this.client.ready();
        if (!this.waiting.length || this.closed) return;
        if (!ready || this.generations.occupied || !this.gate.tryAcquire(OWNER)) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.pump(), 1500);
          this.timer.unref();
          return;
        }
        const id = this.waiting.shift() as string;
        const abort = new AbortController();
        try {
          const finished = this.run(id, abort);
          this.current = { id, abort, finished };
          await finished;
        } finally { this.current = null; this.gate.release(OWNER); }
      }
    } finally { this.running = false; }
  }

  private async run(id: string, abort: AbortController): Promise<void> {
    let completed = false;
    try {
      const row = await this.store.get(id);
      if (!row) return;
      await this.cleanup(id);
      await this.publish(id, { status: 'running', stage: 'preparing', error: null });
      vtrace('transcription.started', 'ok', { id });
      const body = { model_id: row.modelId, folder: transcriptDir(id), url: row.sourceUrl,
        path: row.sourceFile ? join(transcriptDir(id), row.sourceFile) : null, language: row.language };
      for await (const event of this.client.read(body, abort.signal)) {
        if (abort.signal.aborted) break;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') { completed = true; break; }
        await this.apply(row, event);
      }
      if (!completed && !abort.signal.aborted) throw new Error(tr('transcription.error.interrupted'));
      await this.finish(id, completed ? 'done' : this.closed ? 'failed' : 'cancelled',
        this.closed && !completed ? tr('transcription.error.interrupted') : null);
    } catch (error) {
      await this.finish(id, abort.signal.aborted && !this.closed ? 'cancelled' : 'failed',
        this.closed ? tr('transcription.error.interrupted') : abort.signal.aborted ? null : error instanceof Error ? error.message : tr('transcription.error.failed'));
    } finally {
      await this.client.stop().catch(() => this.logger.warn('Could not confirm transcription worker shutdown'));
      await this.cleanup(id);
    }
  }

  /** SIGKILL cannot run Python's TemporaryDirectory cleanup. Keep the retained upload only. */
  async cleanup(id: string): Promise<void> {
    const folder = transcriptDir(id);
    const names = await readdir(folder).catch(() => [] as string[]);
    for (const name of names.filter((value) => value.startsWith('transcribe-'))) {
      await rm(join(folder, name), { recursive: true, force: true });
    }
  }

  /** Sweep even terminal rows: a crash can occur between persisting completion and cleanup. */
  async cleanupAll(): Promise<void> {
    const folders = await readdir(join(studioDataDir(), 'transcripts'), { withFileTypes: true }).catch(() => []);
    for (const folder of folders) if (folder.isDirectory()) await this.cleanup(folder.name);
  }

  private async apply(row: TranscriptEntity, event: TranscriptEvent): Promise<void> {
    if (event.type === 'prepared') {
      row.duration = event.duration;
      await this.publish(row.id, { duration: event.duration, stage: 'transcribing', progress: 30,
        ...(event.title ? { title: event.title } : {}) });
    } else if (event.type === 'progress') {
      const fraction = event.total > 0 ? Math.min(1, event.done / event.total) : null;
      await this.publish(row.id, { stage: event.stage, progress: fraction === null ? null : event.stage === 'downloading' ? fraction * 20 : 20 + fraction * 10 });
    } else if (event.type === 'segment') {
      row.text = [row.text, event.text.trim()].filter(Boolean).join('\n\n');
      await this.publish(row.id, { text: row.text, language: event.language || row.language,
        processedSeconds: event.done, progress: row.duration ? Math.min(99, 30 + event.done / row.duration * 70) : null });
    }
  }

  private async finish(id: string, status: TranscriptStatus, error: string | null = null): Promise<void> {
    await this.publish(id, { status, stage: status, error, ...(status === 'done' ? { progress: 100 } : {}) });
    vtrace(`transcription.${status === 'done' ? 'completed' : status}`, 'ok', { id });
  }

  private async publish(id: string, patch: Partial<TranscriptEntity>): Promise<void> {
    const row = await this.store.update(id, patch);
    if (row) this.events.publish('transcription.updated', transcriptDto(row));
  }
}
