/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { Observable, Subject, Subscription, filter } from 'rxjs';
import { EngineClient, EngineError, EngineEvent, EngineEventRelay, EngineUnavailableError } from 'src/modules/engine';
import { AssetEntity, AssetFileService, AssetService, StudioEvents, nowSeconds } from 'src/modules/media-library';
import { MessageEntity, MessageStatus } from '../entities/MessageEntity';
import { mergeProgress, outputToAssetInput, previewToProgress, toBrowserProgress, type ProgressState } from '../mappers/jobEventMapper';
import {
  engineUnreachable, interruptedByEngine, type EngineJobOutput, type EngineJobState, type JobEventData, type JobKind,
  type QueueEntry,
} from '../types/jobTypes';
import { EngineBusyGate } from './EngineBusyGate';
import { JobRequestBuilder } from './JobRequestBuilder';
import { MessageService } from './MessageService';

/** What the engine's queue looks like to a caller: one generation at a time, the rest waits here. */
export interface QueueSnapshot {
  current: string | null;
  pending: string[];
}

/** Payload of `studio.queue.updated` and of `GET /api/queue`: the running message and the waiting ones, in order. */
export interface QueuePublic {
  current: string | null;
  queue: string[];
}

/**
 * The queue of generations ("which message next") and the job runner on the Nest side.
 *
 * The engine runs one generation at a time and keeps no conversation: Nest holds the waiting messages, submits the
 * next one when the previous one ended (`job.done`, `job.failed` or `job.cancelled`), and turns the engine's job
 * events into message updates, asset rows and browser events (`studio.*`, same names and shapes as the legacy SSE).
 *
 * Message states: `queued` (here, or just submitted) -> `loading` (`job.started`: model loading or starting) ->
 * `running` (first `job.progress` with phase `running`) -> `done` | `error` | `cancelled`. A message still busy when
 * the server starts is failed (a generation is never resumed). Events are handled one after the other, in order.
 */
@Injectable()
export class GenerationQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GenerationQueueService.name);
  private pending: QueueEntry[] = [];
  private current: QueueEntry | null = null;
  private readonly progress = new Map<string, ProgressState>();
  private chain: Promise<void> = Promise.resolve();
  private lastQueueKey = '';
  private readonly subscriptions: Subscription[] = [];
  private readonly idleSubject = new Subject<void>();

  constructor(
    private readonly messages: MessageService,
    private readonly assets: AssetService,
    private readonly files: AssetFileService,
    private readonly builder: JobRequestBuilder,
    private readonly engine: EngineClient,
    private readonly relay: EngineEventRelay,
    private readonly events: StudioEvents,
    /** Held while a chat reply runs: no job is handed to the engine meanwhile (it would answer 409). */
    @Optional() private readonly gate?: EngineBusyGate,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const failed = await this.messages.failInterrupted();
    if (failed) this.logger.warn(`${failed} generation(s) interrupted by the last stop were marked as failed`);
    this.subscriptions.push(
      this.relay.events$.subscribe((event) => this.serial(() => this.handle(event))),
      this.relay.linkChanges$.pipe(filter((connected) => connected)).subscribe(() => this.serial(() => this.reconcile())),
    );
    if (this.gate) this.subscriptions.push(this.gate.released$.subscribe(() => this.serial(() => this.pump())));
    if (this.relay.connected) this.serial(() => this.reconcile());
  }

  onModuleDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  /** True while a generation runs or waits: the chat answers `busy` then (one model at a time). */
  get occupied(): boolean {
    return this.current !== null || this.pending.length > 0;
  }

  /** Emits each time the queue has nothing running or waiting after a step: what a private generation waits for. */
  get idle$(): Observable<void> {
    return this.idleSubject.asObservable();
  }

  snapshot(): QueueSnapshot {
    return { current: this.current?.messageId ?? null, pending: this.pending.map((e) => e.messageId) };
  }

  /** The queue in its public form (the waiting messages exclude the running one, like the former engine status). */
  publicQueue(): QueuePublic {
    const { current, pending } = this.snapshot();
    return { current, queue: pending };
  }

  /** Tells the browser the position of every waiting message, only when the order or the running message changed. */
  private publishQueue(): void {
    const queue = this.publicQueue();
    const key = JSON.stringify(queue);
    if (key === this.lastQueueKey) return;
    this.lastQueueKey = key;
    this.events.publish('queue.updated', queue);
  }

  /** Progress of the running generation (what a reconnecting browser needs), in the browser shape. */
  progressSnapshot(): Record<string, unknown>[] {
    const entry = this.current;
    const state = entry && this.progress.get(entry.messageId);
    return entry && state ? [toBrowserProgress(entry.messageId, entry.conversationId, state)] : [];
  }

  /** Adds a `queued` assistant message to the queue; it is submitted as soon as the engine is free. */
  enqueue(message: { id: string; conversationId: string }, kind: JobKind): void {
    this.pending.push({ messageId: message.id, conversationId: message.conversationId, kind, running: false, submitted: false, cancelRequested: false });
    this.publishQueue();
    this.serial(() => this.pump());
  }

  /**
   * Stops a generation: a waiting one is cancelled at once, the running one is asked to stop (the engine ends it with
   * `job.cancelled`). False when the message is neither waiting nor running.
   */
  async cancel(messageId: string): Promise<boolean> {
    const index = this.pending.findIndex((e) => e.messageId === messageId);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.publishQueue();
      await this.finishMessage(messageId, 'cancelled', null);
      return true;
    }
    if (this.current?.messageId !== messageId) return false;
    if (!this.current.submitted) {
      this.current.cancelRequested = true; // still being handed to the engine: stopped as soon as it has it
      return true;
    }
    try {
      await this.engine.post('/engine/v1/jobs/{job_id}/cancel', { params: { job_id: messageId } });
      return true;
    } catch (error) {
      if (error instanceof EngineError && error.status === 409) return false; // it just ended: its events are on the way
      if (error instanceof EngineError && error.status === 404) {
        this.serial(() => this.endCurrent('error', interruptedByEngine())); // the engine lost it (restart)
        return true;
      }
      throw error;
    }
  }

  /** Runs `task` after the previous one: events and submissions never interleave. Errors are logged, never thrown. */
  private serial(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((error: unknown) => {
      this.logger.error(`generation queue: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }).then(() => {
      this.publishQueue();
      if (!this.occupied) this.idleSubject.next();
    });
  }

  /** Test hook: resolves when everything queued so far was handled. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async pump(): Promise<void> {
    while (!this.current && this.pending.length) {
      if (this.gate?.busy) {
        if (this.gate.preemptible) void this.gate.preempt(); // a title being written yields; `released$` pumps again
        return;
      }
      const entry = this.pending.shift() as QueueEntry;
      this.current = entry; // held from here: a cancellation now is recorded on the entry
      const message = await this.messages.getEntity(entry.messageId);
      if (!message || message.status !== 'queued' || entry.cancelRequested) {
        this.current = null; // deleted, settled or cancelled while waiting
        if (message && entry.cancelRequested) await this.finishMessage(entry.messageId, 'cancelled', null);
        continue;
      }
      if (await this.submit(entry, message)) return;
    }
  }

  /** True when the engine took the job; otherwise the message is failed and the slot is free again. */
  private async submit(entry: QueueEntry, message: MessageEntity): Promise<boolean> {
    try {
      await this.engine.post('/engine/v1/jobs', { body: await this.builder.build(message, entry.kind) });
      entry.submitted = true;
      if (entry.cancelRequested) {
        await this.engine.post('/engine/v1/jobs/{job_id}/cancel', { params: { job_id: entry.messageId } }).catch(() => undefined);
      }
      return true;
    } catch (error) {
      this.current = null;
      await this.finishMessage(entry.messageId, 'error', this.submitError(error));
      return false;
    }
  }

  private submitError(error: unknown): string {
    if (error instanceof EngineUnavailableError) return engineUnreachable();
    if (error instanceof EngineError) return typeof error.detail === 'string' ? error.detail : error.message;
    return error instanceof Error ? error.message : String(error);
  }

  private async handle(event: EngineEvent): Promise<void> {
    if (!event.name.startsWith('job.')) return;
    const data = event.data as JobEventData;
    const entry = this.current;
    if (!entry || entry.messageId !== data.job_id) return; // not a job of ours (legacy UI, stale event)
    switch (event.name) {
      case 'job.started':
        return this.onStarted(entry, data);
      case 'job.progress':
        return this.onProgress(entry, data);
      case 'job.preview':
        return this.publishProgress(entry, previewToProgress(data));
      case 'job.output':
        return this.registerOutput(entry, data as unknown as EngineJobOutput);
      case 'job.done':
        return this.endCurrent('done', null);
      case 'job.cancelled':
        return this.endCurrent('cancelled', null);
      case 'job.failed':
        return this.endCurrent('error', typeof data.error === 'string' ? data.error : tr('studioCore.job.generationFailed'));
      default:
    }
  }

  private async onStarted(entry: QueueEntry, data: JobEventData): Promise<void> {
    await this.updateMessage(entry.messageId, {
      status: 'loading', startedAt: nowSeconds(), params: data.params as Record<string, unknown>,
    });
  }

  private async onProgress(entry: QueueEntry, data: JobEventData): Promise<void> {
    if (data.phase === 'running' && !entry.running) {
      entry.running = true;
      await this.updateMessage(entry.messageId, { status: 'running' });
    }
    this.publishProgress(entry, data);
  }

  private publishProgress(entry: QueueEntry, update: Record<string, unknown>): void {
    const state = mergeProgress(this.progress.get(entry.messageId), update);
    this.progress.set(entry.messageId, state);
    this.events.publish('job.progress', toBrowserProgress(entry.messageId, entry.conversationId, state));
  }

  /** Stores the file a job produced; the file of a message deleted in the meantime is removed instead. */
  private async registerOutput(entry: QueueEntry, output: EngineJobOutput): Promise<void> {
    if (!(await this.messages.get(entry.messageId))) {
      await this.files.removeFiles([{ kind: 'generated', filename: output.filename, thumb: output.thumb ?? null } as AssetEntity]);
      return;
    }
    const existing = await this.assets.get(output.asset_id);
    const asset = existing ?? (await this.assets.create(outputToAssetInput(output, entry.conversationId, entry.messageId)));
    if (!existing) this.events.publish('job.image', { message_id: entry.messageId, conversation_id: entry.conversationId, asset });
  }

  /** The running job ended: settle its message, free the engine slot and submit the next generation. */
  private async endCurrent(status: Extract<MessageStatus, 'done' | 'error' | 'cancelled'>, error: string | null): Promise<void> {
    const entry = this.current;
    if (!entry) return;
    this.current = null;
    await this.finishMessage(entry.messageId, status, error);
    await this.pump();
  }

  private async finishMessage(messageId: string, status: MessageStatus, error: string | null): Promise<void> {
    this.progress.delete(messageId);
    await this.updateMessage(messageId, { status, error, finishedAt: nowSeconds() });
  }

  /** Updates a message and tells the browser; a message deleted meanwhile is ignored. */
  private async updateMessage(id: string, fields: Parameters<MessageService['update']>[1]): Promise<void> {
    const updated = await this.messages.update(id, fields);
    if (updated) this.events.publish('message.updated', updated);
  }

  /**
   * After the stream (re)connects: the engine may have restarted, or ended our job while no one listened. Settles the
   * running message from the engine's record, cancels jobs of earlier runs that still hold the engine, and goes on.
   */
  private async reconcile(): Promise<void> {
    try {
      const { jobs } = await this.engine.get('/engine/v1/jobs');
      await this.cancelOrphans(jobs.map((j) => j.job_id));
      const entry = this.current;
      if (entry && !jobs.some((j) => j.job_id === entry.messageId)) await this.settleFromRecord(entry);
    } catch (error) {
      this.logger.warn(`reconciliation with the engine failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.pump();
  }

  /** A job of an earlier Nest run (its message exists and is not ours any more) must not keep the engine busy. */
  private async cancelOrphans(activeIds: string[]): Promise<void> {
    for (const id of activeIds) {
      if (id === this.current?.messageId || !(await this.messages.getEntity(id))) continue; // unknown ids: not ours (legacy UI)
      await this.engine.post('/engine/v1/jobs/{job_id}/cancel', { params: { job_id: id } }).catch(() => undefined);
    }
  }

  private async settleFromRecord(entry: QueueEntry): Promise<void> {
    const record = await this.engine
      .get('/engine/v1/jobs/{job_id}', { params: { job_id: entry.messageId } })
      .catch((error: unknown) => (error instanceof EngineError && error.status === 404 ? null : Promise.reject(error)));
    if (!record) return this.endCurrent('error', interruptedByEngine());
    for (const output of record.outputs) await this.registerOutput(entry, output);
    const ended = this.endOf(record);
    if (ended) await this.endCurrent(ended.status, ended.error);
  }

  private endOf(record: EngineJobState): { status: 'done' | 'error' | 'cancelled'; error: string | null } | null {
    if (record.state === 'done') return { status: 'done', error: null };
    if (record.state === 'cancelled') return { status: 'cancelled', error: null };
    if (record.state === 'failed') return { status: 'error', error: record.error ?? tr('studioCore.job.generationFailed') };
    return null;
  }
}
