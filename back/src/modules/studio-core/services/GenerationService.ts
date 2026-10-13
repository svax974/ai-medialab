/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { AssetFileService, AssetService, StudioEvents, newId, nowSeconds } from 'src/modules/media-library';
import { MessageDto } from '../dto/MessageDto';
import type { CreateGenerationInput, EngineJobCheck, RetryInput } from '../types/jobTypes';
import { DEFAULT_CONVERSATION_TITLE } from '../types/studioTypes';
import { ConversationService } from './ConversationService';
import { GenerationQueueService } from './GenerationQueueService';
import { seedsFor, titleFromPrompt } from './generationParams';
import { MessageService } from './MessageService';

export interface CreatedGeneration {
  conversation_id: string;
  user_message: MessageDto;
  assistant_message: MessageDto;
}

/** Creation, retry, cancellation and deletion of generation messages (`/api/messages`), on top of the queue. */
@Injectable()
export class GenerationService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly assets: AssetService,
    private readonly files: AssetFileService,
    private readonly queue: GenerationQueueService,
    private readonly engine: EngineClient,
    private readonly events: StudioEvents,
  ) {}

  /**
   * A prompt and its generation: the engine says whether the model can do it (422 with the message to show), then the
   * conversation (created from the prompt when absent), the user message with its references and the queued assistant
   * message are stored, and the generation is queued. Everything is checked before anything is written.
   */
  async create(input: CreateGenerationInput): Promise<CreatedGeneration> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new UnprocessableEntityException('Le prompt est vide.');
    if (input.conversationId && !(await this.conversations.getSummary(input.conversationId))) {
      throw new NotFoundException('Conversation introuvable.');
    }
    const media = await this.referenceMedia(input.referenceIds);
    const check = await this.check(input.modelId, media);
    const count = Math.min(input.count, check.max_count);
    const params: Record<string, unknown> = { ...check.default_params, ...input.params, count };
    params.seeds = seedsFor(params, count);

    const conversationId = await this.conversationFor(input, prompt, check);
    const now = nowSeconds();
    const user = await this.messages.create({
      id: newId(), conversationId, role: 'user', prompt, createdAt: now, referenceIds: input.referenceIds,
    });
    await this.assets.adoptOrphans(input.referenceIds, conversationId);
    const assistant = await this.messages.create({
      id: newId(), conversationId, parentId: user.id, role: 'assistant', prompt, modelId: input.modelId, params,
      status: 'queued', createdAt: now + 0.001,
    });
    await this.conversations.touch(conversationId);
    this.queue.enqueue({ id: assistant.id, conversationId }, check.kind);
    await this.publishConversation(conversationId);
    return { conversation_id: conversationId, user_message: user, assistant_message: assistant };
  }

  /** A new generation for the same prompt (other model or parameters allowed), queued behind the others. */
  async retry(messageId: string, input: RetryInput): Promise<MessageDto> {
    const original = await this.messages.get(messageId);
    if (!original || original.role !== 'assistant') throw new NotFoundException('Génération introuvable.');
    const params: Record<string, unknown> = { ...original.params, ...(input.params ?? {}) };
    const count = Number(params.count ?? 1) || 1;
    if (!input.keepSeed) params.seed = null;
    params.seeds = input.keepSeed ? (original.params.seeds ?? null) : seedsFor(params, count);
    const modelId = input.modelId ?? original.model_id ?? '';
    const media = original.parent_id ? (await this.messages.referencesOf(original.parent_id)).map((a) => a.media) : [];
    const check = await this.check(modelId, media);
    const created = await this.messages.create({
      id: newId(), conversationId: original.conversation_id, parentId: original.parent_id, role: 'assistant',
      prompt: original.prompt, modelId, params, status: 'queued',
    });
    await this.conversations.touch(original.conversation_id);
    this.queue.enqueue({ id: created.id, conversationId: original.conversation_id }, check.kind);
    this.events.publish('message.updated', created);
    return created;
  }

  async cancel(messageId: string): Promise<{ ok: true }> {
    if (!(await this.queue.cancel(messageId))) throw new ConflictException("Cette génération n'est plus en cours.");
    return { ok: true };
  }

  /** Deletes a message: a prompt takes the generations that answer it with it. Their assets and files go too. */
  async remove(messageId: string): Promise<{ ok: true; deleted: string[] }> {
    const message = await this.messages.get(messageId);
    if (!message) throw new NotFoundException('Message introuvable.');
    const ids = message.role === 'user' ? [messageId, ...(await this.messages.childIds(messageId))] : [messageId];
    for (const id of ids) await this.queue.cancel(id);
    const assets = await this.messages.assetsOfMessages(ids);
    await this.messages.removeMany(ids);
    await this.files.purge(assets);
    this.events.publish('message.deleted', { conversation_id: message.conversation_id, ids });
    await this.publishConversation(message.conversation_id);
    return { ok: true, deleted: ids };
  }

  /** Deletes a conversation with its messages, assets and files; running generations are stopped first. */
  async removeConversation(conversationId: string): Promise<{ ok: true }> {
    for (const id of await this.messages.busyIds(conversationId)) await this.queue.cancel(id);
    const assets = await this.messages.assetsOfConversation(conversationId);
    await this.conversations.remove(conversationId);
    await this.files.purge(assets);
    this.events.publish('conversation.deleted', { id: conversationId });
    return { ok: true };
  }

  async publishConversation(conversationId: string): Promise<void> {
    const summary = await this.conversations.getSummary(conversationId);
    if (summary) this.events.publish('conversation.updated', summary);
  }

  private async conversationFor(input: CreateGenerationInput, prompt: string, check: EngineJobCheck): Promise<string> {
    if (!input.conversationId) {
      return (await this.conversations.create({ title: titleFromPrompt(prompt), mode: check.kind })).id;
    }
    // First generation of a conversation created empty: title it from the prompt.
    const existing = await this.conversations.getSummary(input.conversationId);
    if (existing?.title === DEFAULT_CONVERSATION_TITLE && !(await this.messages.hasMessages(input.conversationId))) {
      await this.conversations.update(input.conversationId, { title: titleFromPrompt(prompt) });
    }
    return input.conversationId;
  }

  private async referenceMedia(ids: string[]): Promise<string[]> {
    const media: string[] = [];
    for (const id of ids) {
      const asset = await this.assets.get(id);
      if (!asset) throw new UnprocessableEntityException(`Image de référence introuvable : ${id}`);
      media.push(asset.media);
    }
    return media;
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
}
