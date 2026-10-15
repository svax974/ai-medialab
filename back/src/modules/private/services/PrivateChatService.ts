/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { EngineClient } from 'src/modules/engine';
import {
  ChatError, ChatModelService, ChatReplyService, PromptEnhanceService, ReplyState, buildHistory,
  type EngineChatMessage, type PromptKind, type ReplySink, type StoredAttachment,
} from 'src/modules/chat';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { PrivateChatAttachmentService } from './PrivateChatAttachmentService';
import type { PrivateChatBody } from './privateChatValidation';
import { PrivateSessionService } from './PrivateSessionService';

/** Holds the engine while a private reply runs (a distinct owner from the private generations': see `EngineBusyGate`). */
const GATE_OWNER = 'private-chat';
const BUSY_GENERATION = "Une génération d'image, d'audio ou de vidéo est en cours ou en attente : attendez sa fin ou annulez-la avant de discuter.";
const BUSY_REPLY = 'Une réponse est déjà en cours de génération.';

/**
 * The chat of the private session, without a state: the browser sends the whole history with every request and the answer
 * comes back as the events of the normal chat (`loading`, `delta`, `reasoning`, `tool`, `usage`) and a last `done` (or an
 * `error`), after an `accepted` that says the reply starts (the browser adds its messages to its own conversation then:
 * a refusal before it, `busy`, `no_model`..., is an `error` without `id`, as in the normal chat where it creates nothing);
 * nothing is stored, no title is made, no line is logged. It runs the same rounds as the normal chat
 * (`ChatReplyService.streamRounds`: tools included, on only when the request turns them on) with a state that writes
 * nowhere. When the session ends the chat model is unloaded: its prompt cache lives in the memory of `llama-server`.
 */
@Injectable()
export class PrivateChatService implements OnModuleInit {
  private used = false;
  private current: AbortController | null = null;

  constructor(
    private readonly session: PrivateSessionService,
    private readonly replies: ChatReplyService,
    private readonly models: ChatModelService,
    private readonly attachments: PrivateChatAttachmentService,
    private readonly enhancer: PromptEnhanceService,
    private readonly queue: GenerationQueueService,
    private readonly gate: EngineBusyGate,
    private readonly engine: EngineClient,
  ) {}

  onModuleInit(): void {
    this.session.onWipe(() => this.wipe());
  }

  private requireSession(): void {
    this.session.touch();
    if (!this.session.active) throw new ConflictException("Aucune session privée n'est ouverte.");
  }

  /** One reply into `sink`. A refusal before the stream (no session) is an HTTP error; the others are `error` events. */
  async reply(body: PrivateChatBody, sink: ReplySink): Promise<void> {
    this.requireSession();
    const history = await this.history(body); // an attachment that is not in the session is a plain 422, before any stream
    if (this.queue.occupied) return this.refuse(sink, new ChatError('busy', BUSY_GENERATION));
    if (!this.gate.tryAcquire(GATE_OWNER)) return this.refuse(sink, new ChatError('busy', BUSY_REPLY));
    const abort = new AbortController();
    const stop = () => abort.abort();
    sink.signal.addEventListener('abort', stop, { once: true });
    if (sink.signal.aborted) stop();
    this.current = abort;
    const state = new ReplyState(Date.now(), async () => undefined);
    let accepted = false;
    try {
      const model = await this.models.resolve(body.settings.model_id);
      this.used = true;
      sink.emit('accepted', { id: body.replyId });
      accepted = true;
      await this.replies.streamRounds(body.settings, model, history, state, body.replyId, sink, abort.signal, true);
      sink.emit('done', { id: body.replyId, stats: state.stats(), tool_runs: state.toolRuns });
    } catch (error) {
      if (!abort.signal.aborted) this.fail(sink, error, accepted ? body.replyId : undefined);
    } finally {
      await state.flush().catch(() => undefined); // clears the write timer: the state writes nowhere
      sink.signal.removeEventListener('abort', stop);
      this.current = null;
      this.gate.release(GATE_OWNER);
    }
  }

  /** ✨ for the studios, in the private session: the same stateless improvement as the normal chat (nothing is stored). */
  enhance(kind: PromptKind, prompt: string, modelId: string | undefined): Promise<{ prompt: string; model_id: string }> {
    this.requireSession();
    this.used = true;
    return this.enhancer.enhance(kind, prompt, modelId);
  }

  private async history(body: PrivateChatBody): Promise<EngineChatMessage[]> {
    const messages = await Promise.all(body.messages.map(async (m) => ({
      role: m.role,
      content: m.content,
      attachments: (await this.attachments.resolve(m.attachments)) as StoredAttachment[],
    })));
    return buildHistory(body.settings.system_prompt, messages, {
      imagePath: (name) => this.attachments.pathOf(name),
      readText: (name) => this.attachments.readText(name),
    });
  }

  private refuse(sink: ReplySink, error: ChatError): void {
    sink.emit('error', { code: error.code, message: error.message });
  }

  /** A failure as an `error` event. Only what the code itself says goes out: an unknown one is told in general terms, never logged. */
  private fail(sink: ReplySink, error: unknown, id: string | undefined): void {
    const known = error instanceof ChatError;
    sink.emit('error', {
      code: known ? error.code : 'upstream', ...(id ? { id } : {}),
      message: known ? error.message : 'La réponse a échoué de façon inattendue.',
    });
  }

  /** Before the session folder goes: stops a reply and unloads the chat model if the session used it (best effort). */
  private async wipe(): Promise<void> {
    this.current?.abort();
    if (!this.used) return;
    this.used = false;
    await this.engine.post('/engine/v1/llm/unload').catch(() => undefined);
  }
}

