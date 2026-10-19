/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Subscription, filter } from 'rxjs';
import { join } from 'path';
import { VoiceService } from 'src/modules/audio-studio';
import { EngineClient, EngineError, EngineEvent, EngineEventRelay, EngineUnavailableError, engineErrorToHttp } from 'src/modules/engine';
import { StudioEvents, nowSeconds } from 'src/modules/media-library';
import {
  engineUnreachable, EngineBusyGate, GenerationQueueService, interruptedByEngine, jobVoices, libraryVoiceIds, mergeProgress,
  previewToProgress, seedsFor, titleFromPrompt, toBrowserProgress,
  type CreateGenerationInput, type EngineJobCheck, type EngineJobOutput, type EngineJobSubmit, type JobEventData, type JobKind,
  type MessageDto, type RetryInput,
} from 'src/modules/studio-core';
import { PRIVATE_OWNER, type PrivateAsset, type PrivateMessage } from '../types/privateTypes';
import { removeSessionFile, sessionPath } from './privateFiles';
import { PrivateEvents } from './PrivateEvents';
import { PrivateSessionService } from './PrivateSessionService';
import { PrivateStore } from './PrivateStore';

interface Running {
  messageId: string;
  conversationId: string;
  kind: JobKind;
  running: boolean;
  submitted: boolean;
  cancelRequested: boolean;
  ended: Promise<void>;
  settle: () => void;
}

export interface CreatedPrivateGeneration {
  conversation_id: string;
  user_message: MessageDto;
  assistant_message: MessageDto;
}

/** How long ending the session waits for the engine to let go of the files of a job it was asked to cancel. */
export const WIPE_WAIT_MS = 8000;

/**
 * Generations of the private session: the same flow as `GenerationService` + `GenerationQueueService`, held in memory.
 * One at a time, and never together with a normal generation or a chat reply: it waits for the normal queue to be idle
 * and holds the engine gauge (`EngineBusyGate`) while its job runs, which the normal queue and the chat both respect.
 * It never writes a log line with a prompt, a path or an engine error text.
 */
@Injectable()
export class PrivateGenerationService implements OnModuleInit, OnModuleDestroy {
  private pending: string[] = [];
  private current: Running | null = null;
  private readonly progress = new Map<string, Record<string, unknown>>();
  private chain: Promise<void> = Promise.resolve();
  private readonly subscriptions: Subscription[] = [];
  /** Overridable (tests): see `WIPE_WAIT_MS`. */
  wipeWaitMs = WIPE_WAIT_MS;

  constructor(
    private readonly session: PrivateSessionService,
    private readonly store: PrivateStore,
    private readonly events: PrivateEvents,
    private readonly studioEvents: StudioEvents,
    private readonly engine: EngineClient,
    private readonly relay: EngineEventRelay,
    private readonly queue: GenerationQueueService,
    private readonly gate: EngineBusyGate,
    private readonly voices: VoiceService,
  ) {}

  onModuleInit(): void {
    this.session.onWipe(() => this.stopEverything());
    this.subscriptions.push(
      this.relay.events$.subscribe((event) => this.serial(() => this.handle(event))),
      this.relay.linkChanges$.pipe(filter((connected) => connected)).subscribe(() => this.serial(() => this.reconcile())),
      this.queue.idle$.subscribe(() => this.serial(() => this.pump())),
      this.gate.released$.subscribe(() => this.serial(() => this.pump())),
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  /** The private queue as the browser knows the normal one (`GET /api/queue`). */
  publicQueue(): { current: string | null; queue: string[] } {
    return { current: this.current?.messageId ?? null, queue: [...this.pending] };
  }

  progressSnapshot(): Record<string, unknown>[] {
    const entry = this.current;
    const state = entry && this.progress.get(entry.messageId);
    return entry && state ? [toBrowserProgress(entry.messageId, entry.conversationId, state)] : [];
  }

  idle(): Promise<void> {
    return this.chain;
  }

  // Creation, retry, cancel, delete ----------------------------------------------------------------------------------

  async create(input: CreateGenerationInput): Promise<CreatedPrivateGeneration> {
    this.requireSession();
    const prompt = input.prompt.trim();
    if (!prompt) throw new UnprocessableEntityException(tr('private.error.promptEmpty'));
    if (input.conversationId && !this.store.getConversation(input.conversationId)) throw new NotFoundException(tr('private.error.conversationNotFound'));
    const media = input.referenceIds.map((id) => this.requireAsset(id).media);
    const check = await this.check(input.modelId, media);
    const count = Math.min(input.count, check.max_count);
    const params: Record<string, unknown> = { ...check.default_params, ...input.params, count };
    params.seeds = seedsFor(params, count);
    const conversation = input.conversationId
      ? (this.store.getConversation(input.conversationId) as { id: string; title: string })
      : this.store.createConversation({ title: titleFromPrompt(prompt), mode: check.kind });
    const now = nowSeconds();
    const user = this.store.createMessage({ conversationId: conversation.id, role: 'user', prompt, createdAt: now, referenceIds: input.referenceIds });
    this.store.adopt(input.referenceIds, conversation.id);
    const assistant = this.store.createMessage({
      conversationId: conversation.id, role: 'assistant', parentId: user.id, prompt, modelId: input.modelId, params, status: 'queued', createdAt: now + 0.001,
    });
    this.store.touch(conversation.id);
    this.enqueue(assistant.id);
    this.events.changed('conversation', { conversation_id: conversation.id });
    return { conversation_id: conversation.id, user_message: this.store.messageDto(user), assistant_message: this.store.messageDto(assistant) };
  }

  async retry(messageId: string, input: RetryInput): Promise<MessageDto> {
    this.requireSession();
    const original = this.store.getMessage(messageId);
    if (!original || original.role !== 'assistant') throw new NotFoundException(tr('private.error.generationNotFound'));
    const params: Record<string, unknown> = { ...original.params, ...(input.params ?? {}) };
    const count = Number(params.count ?? 1) || 1;
    if (!input.keepSeed) params.seed = null;
    params.seeds = input.keepSeed ? (original.params.seeds ?? null) : seedsFor(params, count);
    const modelId = input.modelId ?? original.modelId ?? '';
    const media = original.parentId ? this.store.referencesOf(original.parentId).map((a) => a.media) : [];
    await this.check(modelId, media);
    const created = this.store.createMessage({
      conversationId: original.conversationId, role: 'assistant', parentId: original.parentId, prompt: original.prompt, modelId, params, status: 'queued',
    });
    this.store.touch(original.conversationId);
    this.enqueue(created.id);
    this.events.changed('message', { conversation_id: original.conversationId, message_id: created.id });
    return this.store.messageDto(created);
  }

  async cancel(messageId: string): Promise<{ ok: true }> {
    this.requireSession();
    if (!(await this.stop(messageId))) throw new ConflictException(tr('private.error.generationNotRunning'));
    return { ok: true };
  }

  /** A prompt takes the generations that answer it with it; their files go too. */
  async remove(messageId: string): Promise<{ ok: true; deleted: string[] }> {
    this.requireSession();
    const message = this.store.getMessage(messageId);
    if (!message) throw new NotFoundException(tr('private.error.messageNotFound'));
    const ids = message.role === 'user' ? [messageId, ...this.store.childIds(messageId)] : [messageId];
    for (const id of ids) await this.stop(id);
    await this.eraseFiles(this.store.removeMessages(ids));
    this.events.changed('message', { conversation_id: message.conversationId });
    return { ok: true, deleted: ids };
  }

  async removeConversation(conversationId: string): Promise<{ ok: true }> {
    this.requireSession();
    for (const id of this.store.busyIds(conversationId)) await this.stop(id);
    await this.eraseFiles(this.store.deleteConversation(conversationId));
    this.events.changed('conversation', { conversation_id: conversationId });
    return { ok: true };
  }

  async eraseFiles(assets: PrivateAsset[]): Promise<void> {
    const id = this.session.sessionId;
    for (const asset of assets) {
      await removeSessionFile(id, asset.kind === 'upload' ? 'inputs' : 'outputs', asset.filename).catch(() => undefined);
      await removeSessionFile(id, 'thumbs', asset.thumb).catch(() => undefined);
    }
  }

  // The queue shared with the normal generations ---------------------------------------------------------------------

  private enqueue(messageId: string): void {
    this.pending.push(messageId);
    this.events.changed('queue');
    this.serial(() => this.pump());
  }

  /** Stops a waiting generation at once, a running one through the engine. False when it is neither. */
  private async stop(messageId: string): Promise<boolean> {
    const index = this.pending.indexOf(messageId);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.settle(messageId, 'cancelled', null);
      return true;
    }
    const entry = this.current;
    if (entry?.messageId !== messageId) return false;
    if (!entry.submitted) {
      entry.cancelRequested = true;
      return true;
    }
    await this.engine.post('/engine/v1/jobs/{job_id}/cancel', { params: { job_id: messageId } }).catch(() => undefined);
    return true;
  }

  private async pump(): Promise<void> {
    while (!this.current && this.pending.length && this.session.active) {
      if (this.queue.occupied || !this.gate.tryAcquire(PRIVATE_OWNER)) return; // waits for the normal queue / the chat
      const id = this.pending.shift() as string;
      const message = this.store.getMessage(id);
      if (!message || message.status !== 'queued') {
        this.gate.release(PRIVATE_OWNER);
        continue;
      }
      let settle = (): void => undefined;
      const ended = new Promise<void>((resolve) => { settle = resolve; });
      this.current = { messageId: id, conversationId: message.conversationId, kind: 'image', running: false, submitted: false, cancelRequested: false, ended, settle };
      if (await this.submit(this.current, message)) return;
    }
  }

  private async submit(entry: Running, message: PrivateMessage): Promise<boolean> {
    try {
      const check = await this.check(message.modelId ?? '', this.store.referencesOf(message.parentId ?? '').map((a) => a.media));
      entry.kind = check.kind;
      await this.engine.post('/engine/v1/jobs', { body: await this.jobBody(message, check.kind) });
      entry.submitted = true;
      if (entry.cancelRequested) await this.engine.post('/engine/v1/jobs/{job_id}/cancel', { params: { job_id: entry.messageId } }).catch(() => undefined);
      this.events.changed('queue');
      return true;
    } catch (error) {
      await this.endCurrent('error', this.safeMessage(error));
      return false;
    }
  }

  private async jobBody(message: PrivateMessage, kind: JobKind): Promise<EngineJobSubmit> {
    const dir = sessionPath(this.session.sessionId);
    const references = message.parentId ? this.store.referencesOf(message.parentId) : [];
    const voices = kind === 'audio' ? jobVoices(await this.voices.findByIds(libraryVoiceIds(message.params))) : undefined;
    return {
      job_id: message.id, kind, model_id: message.modelId ?? '', prompt: message.prompt, params: message.params,
      inputs: references.map((a) => join(dir, 'inputs', a.filename)), output_dir: join(dir, 'outputs'), private_dir: dir,
      ...(voices ? { voices } : {}),
    };
  }

  // Engine events ----------------------------------------------------------------------------------------------------

  private async handle(event: EngineEvent): Promise<void> {
    if (!event.name.startsWith('job.')) return;
    const data = event.data as JobEventData;
    const entry = this.current;
    if (!entry || entry.messageId !== data.job_id) return; // not ours: a normal generation, or the chat
    switch (event.name) {
      case 'job.started':
        return this.update(entry, { status: 'loading', startedAt: nowSeconds(), params: data.params as Record<string, unknown> });
      case 'job.progress':
        if (data.phase === 'running' && !entry.running) {
          entry.running = true;
          this.update(entry, { status: 'running' });
        }
        return this.publishProgress(entry, data);
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

  private update(entry: Running, fields: Partial<Omit<PrivateMessage, 'id'>>): void {
    this.store.updateMessage(entry.messageId, fields);
    this.events.changed('message', { conversation_id: entry.conversationId, message_id: entry.messageId });
  }

  private publishProgress(entry: Running, update: Record<string, unknown>): void {
    const state = mergeProgress(this.progress.get(entry.messageId), update);
    this.progress.set(entry.messageId, state);
    this.studioEvents.publish('job.progress', toBrowserProgress(entry.messageId, entry.conversationId, state));
  }

  private async registerOutput(entry: Running, output: EngineJobOutput): Promise<void> {
    if (!this.store.getMessage(entry.messageId)) {
      await this.eraseFiles([{ kind: 'generated', filename: output.filename, thumb: output.thumb ?? null } as PrivateAsset]);
      return;
    }
    this.store.addAsset({
      id: output.asset_id, kind: 'generated', media: output.media, filename: output.filename, thumb: output.thumb ?? null,
      originalName: null, width: output.width ?? null, height: output.height ?? null, seed: output.seed ?? null,
      duration: output.duration ?? null, position: output.index, meta: output.meta ?? {},
      conversationId: entry.conversationId, messageId: entry.messageId,
    });
    this.events.changed('message', { conversation_id: entry.conversationId, message_id: entry.messageId });
  }

  private async endCurrent(status: 'done' | 'error' | 'cancelled', error: string | null): Promise<void> {
    const entry = this.current;
    if (!entry) return;
    this.current = null;
    this.progress.delete(entry.messageId);
    this.settle(entry.messageId, status, error);
    this.gate.release(PRIVATE_OWNER);
    entry.settle();
    await this.pump();
  }

  private settle(messageId: string, status: 'done' | 'error' | 'cancelled', error: string | null): void {
    const message = this.store.updateMessage(messageId, { status, error, finishedAt: nowSeconds() });
    if (message) this.events.changed('message', { conversation_id: message.conversationId, message_id: messageId });
    this.events.changed('queue');
  }

  /** After the engine link (re)connects: a running job the engine no longer knows ended with it. */
  private async reconcile(): Promise<void> {
    const entry = this.current;
    if (!entry?.submitted) return;
    try {
      const { jobs } = await this.engine.get('/engine/v1/jobs');
      if (!jobs.some((j) => j.job_id === entry.messageId)) await this.endCurrent('error', interruptedByEngine());
    } catch {
      // unreachable engine: the next reconnection tries again
    }
  }

  // Session end ------------------------------------------------------------------------------------------------------

  /** Before the session folder goes: nothing waits, the running job is stopped and has let go of its files. */
  private async stopEverything(): Promise<void> {
    this.pending = [];
    const entry = this.current;
    if (!entry) return;
    await this.stop(entry.messageId);
    await Promise.race([entry.ended, new Promise<void>((resolve) => setTimeout(resolve, this.wipeWaitMs).unref())]);
    if (this.current === entry) {
      this.current = null;
      this.gate.release(PRIVATE_OWNER);
    }
    this.progress.clear();
  }

  // Helpers ----------------------------------------------------------------------------------------------------------

  private requireSession(): void {
    this.session.touch();
    if (!this.session.active) throw new ConflictException(tr('private.error.noSession'));
  }

  private requireAsset(id: string): PrivateAsset {
    const asset = this.store.getAsset(id);
    if (!asset) throw new UnprocessableEntityException(tr('private.error.referenceImageNotFound', [id]));
    return asset;
  }

  private async check(modelId: string, referenceMedia: string[]): Promise<EngineJobCheck> {
    try {
      return await this.engine.post('/engine/v1/jobs/check', {
        body: { model_id: modelId, reference_media: referenceMedia as ('image' | 'audio' | 'video')[] },
      });
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }

  /** An error as a message to show: only what we wrote ourselves, never a text the engine echoed back from the request. */
  private safeMessage(error: unknown): string {
    if (error instanceof EngineUnavailableError) return engineUnreachable();
    if (error instanceof EngineError && error.status === 409 && typeof error.detail === 'string') return error.detail;
    return tr('private.error.engineRefused');
  }

  /** Runs `task` after the previous one: events and submissions never interleave. Errors are swallowed (no content in logs). */
  private serial(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => undefined);
  }
}
