/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable, Logger, OnModuleDestroy, UnprocessableEntityException } from '@nestjs/common';
import {
  ConversationService, defaultChatTitle, EngineBusyGate, isDefaultChatTitle, GenerationQueueService, GenerationService, titleFromPrompt,
} from 'src/modules/studio-core';
import { StudioEvents } from 'src/modules/media-library';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatAttachmentService } from './ChatAttachmentService';
import { buildHistory, type EngineChatMessage } from './chatHistory';
import { ChatModelService, type ResolvedModel } from './ChatModelService';
import { ChatStoreService } from './ChatStoreService';
import { EngineLlmClient, type LlmChatRequest, type LlmToolCall, type LlmUsage } from './EngineLlmClient';
import { CreationToolsService, isCreationTool, parseCommand, type CreationCommand, type CreationRun } from './CreationToolsService';
import { WEB_TOOL_SCHEMAS, WebToolsService } from './WebToolsService';
import type { EditBody, RegenerateBody, SendBody } from './chatValidation';
import {
  ChatError, MAX_TITLE_CHARS, MAX_TOOL_ROUNDS,
  type ChatSettings, type ChatStats, type CreationModels, type StoredAttachment, type StoredGeneration, type ToolRun,
} from '../types/chatTypes';

/** Where a reply's events go: the SSE response of the route (and the signal that says the client left). */
export interface ReplySink {
  emit(event: string, data: unknown): void;
  readonly signal: AbortSignal;
}

/** What a request asks for, before anything is stored. */
type TurnPlan =
  | { kind: 'new_user'; parentId: string | null; content: string; attachments: StoredAttachment[] }
  | { kind: 'answer'; user: ChatMessageEntity };

/** Holds the engine while a reply runs (see `EngineBusyGate`). */
const GATE_OWNER = 'chat';
const FLUSH_MS = 500;
const TITLE_TIMEOUT_MS = 15_000;
const TITLE_SYSTEM = 'Donne un titre très court (4 à 6 mots) à cette conversation, dans la langue de l\'utilisateur, sans guillemets ni point final. Réponds uniquement par le titre.';

const busyGeneration = (): string => tr('chat.error.busyGeneration');
const busyReply = (): string => tr('chat.error.busyReply');

/** Mutable state of one reply: what has been written, and the throttled write to the database. */
export class ReplyState {
  content = '';
  reasoning = '';
  toolRuns: ToolRun[] = [];
  generations: StoredGeneration[] = [];
  /** The user confirmed going on after the free-memory check refused the load. */
  forceMemory = false;
  promptTokens = 0;
  completionTokens = 0;
  tokensPerSecond: number | null = null;
  contextSize: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private readonly started: number, private readonly write: (fields: Record<string, unknown>) => Promise<void>) {}

  addUsage(usage: LlmUsage): void {
    this.promptTokens = usage.prompt_tokens;
    this.completionTokens += usage.completion_tokens;
    this.tokensPerSecond = usage.tokens_per_second ?? this.tokensPerSecond;
    this.contextSize = usage.context_size ?? this.contextSize;
  }

  stats(): ChatStats {
    return {
      prompt_tokens: this.promptTokens, completion_tokens: this.completionTokens, tokens_per_second: this.tokensPerSecond,
      context_size: this.contextSize, elapsed_ms: Date.now() - this.started,
    };
  }

  /** Writes the text soon (at most every `FLUSH_MS`), not at every token. */
  touch(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  async flush(extra: Record<string, unknown> = {}): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty && !Object.keys(extra).length) return;
    this.dirty = false;
    await this.write({ content: this.content, reasoning: this.reasoning || null, toolRuns: this.toolRuns, generations: this.generations.length ? this.generations : null, ...extra });
  }
}

/**
 * Runs the replies of the chat: stores the messages, asks the engine for the answer, streams it to the browser, runs the
 * web tools the model calls, and settles the message. One reply at a time (`EngineBusyGate`): the engine holds one model.
 */
@Injectable()
export class ChatReplyService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatReplyService.name);
  private readonly active = new Map<string, { conversationId: string; abort: AbortController; titling: boolean }>();

  constructor(
    private readonly store: ChatStoreService,
    private readonly llm: EngineLlmClient,
    private readonly models: ChatModelService,
    private readonly attachments: ChatAttachmentService,
    private readonly tools: WebToolsService,
    private readonly creation: CreationToolsService,
    private readonly conversations: ConversationService,
    private readonly generations: GenerationService,
    private readonly queue: GenerationQueueService,
    private readonly gate: EngineBusyGate,
    private readonly events: StudioEvents,
  ) {}

  onModuleDestroy(): void {
    for (const { abort } of this.active.values()) abort.abort();
  }

  /** Stops the replies of a conversation (before it is deleted). */
  cancelConversation(conversationId: string): void {
    for (const run of this.active.values()) if (run.conversationId === conversationId) run.abort.abort();
  }

  /** True while a reply of this conversation is being generated (writing its title afterwards does not count). */
  runningIn(conversationId: string): boolean {
    return [...this.active.values()].some((run) => run.conversationId === conversationId && !run.titling);
  }

  /** A new user message (a child of `parent_id`, else of the current leaf) and its answer. */
  async send(conversationId: string, body: SendBody, sink: ReplySink): Promise<void> {
    await this.store.requireConversation(conversationId);
    const settings = await this.store.getSettings(conversationId);
    const parentId = body.parentId === undefined ? settings.leaf_id : body.parentId;
    if (parentId) {
      const parent = await this.store.requireMessage(conversationId, parentId);
      if (parent.role !== 'assistant') throw new UnprocessableEntityException(tr('chat.error.notAssistantParent'));
    }
    const attachments = await this.attachments.resolve(body.attachments);
    const command = settings.tools.creation && !attachments.length ? parseCommand(body.content) : null;
    if (command) return this.runCommand(conversationId, settings, parentId, body, command, sink);
    await this.run(conversationId, sink, body.modelId, { kind: 'new_user', parentId, content: body.content, attachments }, body.creationModels);
  }

  /** A new answer to the same message as `messageId` (an assistant message): another try, possibly with another model. */
  async regenerate(conversationId: string, messageId: string, body: RegenerateBody, sink: ReplySink): Promise<void> {
    await this.store.requireConversation(conversationId);
    const answer = await this.store.requireMessage(conversationId, messageId);
    if (answer.role !== 'assistant' || !answer.parentId) throw new UnprocessableEntityException(tr('chat.error.onlyAssistantRegenerate'));
    const user = await this.store.requireMessage(conversationId, answer.parentId);
    await this.run(conversationId, sink, body.modelId, { kind: 'answer', user }, body.creationModels, body.forceMemory);
  }

  /** A new version of a user message (a sibling of `messageId`) and its answer. Attachments omitted: the original ones stay. */
  async edit(conversationId: string, messageId: string, body: EditBody, sink: ReplySink): Promise<void> {
    await this.store.requireConversation(conversationId);
    const original = await this.store.requireMessage(conversationId, messageId);
    if (original.role !== 'user') throw new UnprocessableEntityException(tr('chat.error.onlyUserEdit'));
    const attachments = body.attachments ? await this.attachments.resolve(body.attachments) : original.attachments;
    await this.run(conversationId, sink, undefined, { kind: 'new_user', parentId: original.parentId, content: body.content, attachments }, body.creationModels);
  }

  /**
   * `/image`, `/video`, `/audio`: the generation starts without the language model (nothing is loaded, the engine gauge is
   * not taken: the queue of `studio-core` runs it) and the reply is one fixed sentence.
   */
  private async runCommand(
    conversationId: string, settings: ChatSettings, parentId: string | null, body: SendBody, command: CreationCommand, sink: ReplySink,
  ): Promise<void> {
    if (this.runningIn(conversationId)) return this.refuse(sink, new ChatError('busy', busyReply()));
    let generation: StoredGeneration;
    try {
      generation = await this.creation.runCommand(conversationId, command, body.creationModels);
    } catch (error) {
      if (error instanceof ChatError) return this.refuse(sink, error);
      throw error;
    }
    const plan: TurnPlan = { kind: 'new_user', parentId, content: body.content, attachments: [] };
    const turn = await this.open(conversationId, settings, null, plan, sink);
    const content = generation.pending === 'duration' ? tr('chat.reply.chooseDuration') : tr('chat.reply.generationStarted');
    await this.store.updateMessage(turn.assistant.id, { content, generations: [generation], status: 'done', error: null });
    sink.emit('done', { message: await this.store.toDto((await this.store.getMessage(turn.assistant.id)) as ChatMessageEntity) });
    void this.generations.publishConversation(conversationId);
  }

  // One turn ------------------------------------------------------------------------------------------------------

  private async run(
    conversationId: string, sink: ReplySink, requestedModel: string | undefined, plan: TurnPlan, creationModels?: CreationModels,
    forceMemory = false,
  ): Promise<void> {
    if (this.queue.occupied) return this.refuse(sink, new ChatError('busy', busyGeneration()));
    await this.gate.preempt(); // a title still being written gives the engine up: it never makes a request busy
    if (!this.gate.tryAcquire(GATE_OWNER)) return this.refuse(sink, new ChatError('busy', busyReply()));
    let generating = false;
    try {
      const settings = await this.store.getSettings(conversationId);
      const model = await this.models.resolve(requestedModel ?? settings.model_id);
      const turn = await this.open(conversationId, settings, model, plan, sink);
      generating = true; // `generate` releases the gauge itself when the reply ends
      await this.generate(conversationId, settings, model, turn, sink, creationModels, forceMemory);
    } catch (error) {
      if (!(error instanceof ChatError)) throw error;
      this.refuse(sink, error);
    } finally {
      if (!generating) this.gate.release(GATE_OWNER);
    }
  }

  private refuse(sink: ReplySink, error: ChatError): void {
    sink.emit('error', { code: error.code, message: error.message });
  }

  /** Stores the user message (when new) and the empty answer, and tells the browser. */
  private async open(conversationId: string, settings: ChatSettings, model: Pick<ResolvedModel, 'id'> | null, plan: TurnPlan, sink: ReplySink) {
    const before = await this.store.path(conversationId, settings.leaf_id);
    const user = plan.kind === 'answer'
      ? plan.user
      : await this.store.addMessage({ conversationId, parentId: plan.parentId, role: 'user', content: plan.content, attachments: plan.attachments });
    const assistant = await this.store.addMessage({
      conversationId, parentId: user.id, role: 'assistant', status: 'streaming', modelId: model?.id ?? null, params: { ...settings.params, reasoning: settings.reasoning },
    });
    await this.store.setLeaf(conversationId, assistant.id);
    await this.store.touch(conversationId);
    const wasDefaultTitle = await this.nameFromPrompt(conversationId, user, before.length === 0 && plan.kind === 'new_user');
    if (plan.kind === 'new_user') sink.emit('message', { message: await this.store.toDto(user) });
    sink.emit('message', { message: await this.store.toDto(assistant) });
    void this.generations.publishConversation(conversationId);
    return { user, assistant, wasDefaultTitle, firstExchange: before.length === 0 };
  }

  /** The first message names the conversation at once (the model may find a better title afterwards). */
  private async nameFromPrompt(conversationId: string, user: ChatMessageEntity, isFirst: boolean): Promise<boolean> {
    const summary = await this.conversations.getSummary(conversationId);
    if (!isFirst || !isDefaultChatTitle(summary?.title)) return false;
    const text = user.content.trim() || user.attachments[0]?.original_name || defaultChatTitle();
    await this.conversations.update(conversationId, { title: titleFromPrompt(text) });
    return true;
  }

  private async generate(
    conversationId: string, settings: ChatSettings, model: ResolvedModel,
    turn: { user: ChatMessageEntity; assistant: ChatMessageEntity; wasDefaultTitle: boolean; firstExchange: boolean }, sink: ReplySink,
    creationModels?: CreationModels, forceMemory = false,
  ): Promise<void> {
    const abort = new AbortController();
    const stop = () => abort.abort();
    sink.signal.addEventListener('abort', stop, { once: true });
    if (sink.signal.aborted) stop();
    const id = turn.assistant.id;
    const run = { conversationId, abort, titling: false };
    this.active.set(id, run);
    const state = new ReplyState(Date.now(), (fields) => this.store.updateMessage(id, fields));
    state.forceMemory = forceMemory;
    let finished = false;
    try {
      const history = await buildHistory(settings.system_prompt, await this.store.path(conversationId, turn.user.id), {
        imagePath: (name) => this.attachments.pathOf(name),
        readText: (name) => this.attachments.readText(name),
      });
      const creation = settings.tools.creation && model.caps.tools ? await this.creation.prepare(conversationId, creationModels) : null;
      await this.streamRounds(settings, model, history, state, id, sink, abort.signal, false, creation);
      await state.flush({ status: 'done', stats: state.stats(), error: null });
      sink.emit('done', { message: await this.store.toDto((await this.store.getMessage(id)) as ChatMessageEntity) });
      void this.generations.publishConversation(conversationId);
      finished = true;
    } catch (error) {
      await this.settleFailure(error, id, state, sink, abort.signal);
    }
    try {
      if (finished) await this.writeTitle(conversationId, model, turn, state, sink, run);
    } finally {
      sink.signal.removeEventListener('abort', stop);
      this.active.delete(id);
      this.gate.release(GATE_OWNER);
      void this.generations.publishConversation(conversationId);
    }
  }

  private async settleFailure(error: unknown, id: string, state: ReplyState, sink: ReplySink, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      await state.flush({ status: 'cancelled', stats: state.stats(), error: null }).catch(() => undefined);
      return;
    }
    const known = error instanceof ChatError;
    if (!known) this.logger.error(`chat reply failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    const code = known ? error.code : 'upstream';
    const message = known ? error.message : tr('chat.error.replyFailed');
    await state.flush({ status: 'error', stats: state.stats(), error: message, errorCode: code === 'memory' ? 'memory' : null }).catch(() => undefined);
    sink.emit('error', { code, message, id });
  }

  // Rounds (the model answers, calls tools, answers again) ------------------------------------------------------------

  private request(settings: ChatSettings, model: ResolvedModel, messages: EngineChatMessage[], tools: Record<string, unknown>[], isPrivate: boolean, forceMemory = false): LlmChatRequest {
    const { seed, ...sampling } = settings.params;
    return {
      model_id: model.id,
      ...(isPrivate ? { private: true } : {}),
      ...(forceMemory ? { force_memory: true } : {}),
      messages,
      params: { ...sampling, ...(seed === null || seed === undefined ? {} : { seed }) },
      ...(settings.context_size ? { context_size: settings.context_size } : {}),
      reasoning: settings.reasoning,
      ...(tools.length ? { tools } : {}),
    };
  }

  /**
   * The model answers, calls tools, answers again (5 tool rounds at most), every event going to `sink` and the text into
   * `state`. Nothing is stored here: the stateless private chat (module `private`) runs the same rounds with a state
   * that writes nowhere.
   */
  async streamRounds(
    settings: ChatSettings, model: ResolvedModel, history: EngineChatMessage[], state: ReplyState, id: string, sink: ReplySink, signal: AbortSignal,
    isPrivate = false, creation: CreationRun | null = null,
  ): Promise<void> {
    const web = settings.tools.web && model.caps.tools ? (WEB_TOOL_SCHEMAS as unknown as Record<string, unknown>[]) : [];
    const offered = [...web, ...(creation?.schemas ?? [])];
    let messages = history;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const calls: LlmToolCall[] = [];
      const before = state.content.length;
      if (round > 0 && state.content) this.append(state, id, sink, 'delta', '\n\n');
      for await (const event of this.llm.chat(this.request(settings, model, messages, round < MAX_TOOL_ROUNDS ? offered : [], isPrivate, state.forceMemory), signal)) {
        if (event.type === 'loading') sink.emit('loading', { phase: event.phase, model_id: event.model_id, ...(event.elapsed_s !== undefined ? { elapsed_s: event.elapsed_s } : {}) });
        else if (event.type === 'delta') this.append(state, id, sink, 'delta', event.content);
        else if (event.type === 'reasoning') this.append(state, id, sink, 'reasoning', event.content);
        else if (event.type === 'tool_calls') calls.push(...event.calls);
        else if (event.type === 'usage') {
          state.addUsage(event);
          sink.emit('usage', { id, stats: state.stats() });
        } else if (event.type === 'error') throw new ChatError(event.code, event.message);
      }
      if (!calls.length || round === MAX_TOOL_ROUNDS) return; // the last round offers no tool: a call it makes is ignored
      messages = await this.runTools(messages, calls, state.content.slice(before), state, id, sink, signal, creation);
    }
  }

  private append(state: ReplyState, id: string, sink: ReplySink, kind: 'delta' | 'reasoning', text: string): void {
    if (kind === 'delta') state.content += text;
    else state.reasoning += text;
    state.touch();
    sink.emit(kind, { id, content: text });
  }

  private async runTools(
    messages: EngineChatMessage[], calls: LlmToolCall[], said: string, state: ReplyState, id: string, sink: ReplySink, signal: AbortSignal,
    creation: CreationRun | null,
  ): Promise<EngineChatMessage[]> {
    const next: EngineChatMessage[] = [...messages, { role: 'assistant', content: said, tool_calls: calls as unknown as Record<string, unknown>[] }];
    for (const call of calls) {
      const creating = creation !== null && isCreationTool(call.function.name);
      const running = creating ? creation.begin(call) : this.tools.begin(call);
      state.toolRuns = [...state.toolRuns, running];
      sink.emit('tool', { id, run: running });
      const outcome = creating ? await creation.run(call) : await this.tools.run(call, signal);
      if (creating) state.generations = [...creation.generations];
      state.toolRuns = state.toolRuns.map((r) => (r.id === call.id ? outcome.run : r));
      state.touch();
      sink.emit('tool', { id, run: outcome.run });
      next.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: outcome.content });
    }
    return next;
  }

  // Title -----------------------------------------------------------------------------------------------------------

  /**
   * After `done`, for the first exchange of a conversation still named from its prompt: a short title from the model,
   * written while the stream stays open (it closes with `title`, or without it when the request fails or is cancelled).
   * The engine gauge stays held but is offered to whoever needs it: a new request, an ✨ enhancement or a queued
   * generation cancels the title and takes it at once. Never an error: the prompt-based title stays.
   */
  private async writeTitle(
    conversationId: string, model: ResolvedModel,
    turn: { user: ChatMessageEntity; wasDefaultTitle: boolean; firstExchange: boolean }, state: ReplyState, sink: ReplySink,
    run: { abort: AbortController; titling: boolean },
  ): Promise<void> {
    if (!turn.wasDefaultTitle || !turn.firstExchange || !state.content.trim() || run.abort.signal.aborted) return;
    run.titling = true;
    this.gate.setYield(GATE_OWNER, () => run.abort.abort());
    try {
      const { content } = await this.llm.complete({
        model_id: model.id,
        messages: [
          { role: 'system', content: TITLE_SYSTEM },
          { role: 'user', content: `Question : ${turn.user.content.slice(0, 500)}\n\nRéponse : ${state.content.slice(0, 500)}` },
        ],
        params: { max_tokens: 24, temperature: 0.3 },
        reasoning: 'off',
      }, AbortSignal.any([run.abort.signal, AbortSignal.timeout(TITLE_TIMEOUT_MS)]));
      const title = cleanTitle(content);
      if (!title || run.abort.signal.aborted) return;
      await this.conversations.update(conversationId, { title });
      sink.emit('title', { title });
    } catch {
      // Cancelled, timed out or failed: the title taken from the prompt stays.
    }
  }
}

/** First line of the model's answer, without quotes, markdown marks or final punctuation, cut to `MAX_TITLE_CHARS`. */
export function cleanTitle(raw: string): string {
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const clean = line.replace(/^(titre|title)\s*:\s*/i, '').replace(/^[#>*\-\s"'«“`]+|["'»”`.\s]+$/g, '').trim();
  return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : clean;
}
