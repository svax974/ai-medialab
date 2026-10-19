/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { ConversationService, EngineBusyGate, type ConversationDto } from 'src/modules/studio-core';
import { ChatAttachmentService } from './ChatAttachmentService';
import { ChatReplyService } from './ChatReplyService';
import { ChatStoreService } from './ChatStoreService';
import { CreationToolsService } from './CreationToolsService';
import { exportFileName, toJson, toMarkdown } from './chatExport';
import type { ConfirmBody, ExportFormat } from './chatValidation';
import type { ChatConversation, ChatGeneration, ChatMessage, ChatSettings, ChatSettingsPatch } from '../types/chatTypes';

/** The routes of the chat that do not stream: reading a conversation, its settings, its branches, export, search. */
@Injectable()
export class ChatService {
  constructor(
    private readonly store: ChatStoreService,
    private readonly conversations: ConversationService,
    private readonly attachments: ChatAttachmentService,
    private readonly replies: ChatReplyService,
    private readonly creation: CreationToolsService,
    private readonly engine: EngineClient,
    private readonly gate: EngineBusyGate,
  ) {}

  async get(conversationId: string): Promise<ChatConversation> {
    await this.store.requireConversation(conversationId);
    const summary = (await this.conversations.getSummary(conversationId)) as ConversationDto;
    return { conversation: summary, ...(await this.store.branch(conversationId)) };
  }

  async updateSettings(conversationId: string, patch: ChatSettingsPatch): Promise<ChatSettings> {
    await this.store.requireConversation(conversationId);
    return this.store.updateSettings(conversationId, patch);
  }

  /** Makes `messageId` the branch in use: the leaf becomes its most recent descendant. */
  async switchLeaf(conversationId: string, messageId: string): Promise<ChatConversation> {
    await this.store.requireConversation(conversationId);
    await this.store.requireMessage(conversationId, messageId);
    await this.store.setLeaf(conversationId, await this.store.latestLeafUnder(conversationId, messageId));
    return this.get(conversationId);
  }

  /** Deletes a message and everything under it, with the attachments nothing else uses. */
  async deleteMessage(conversationId: string, messageId: string): Promise<ChatConversation> {
    await this.store.requireConversation(conversationId);
    await this.store.requireMessage(conversationId, messageId);
    if (this.replies.runningIn(conversationId)) {
      throw new ConflictException({ statusCode: 409, message: tr('chat.error.busyDelete'), code: 'busy' });
    }
    const removed = await this.store.deleteSubtree(conversationId, messageId);
    await this.attachments.purgeUnused(conversationId, removed.flatMap((m) => m.attachments ?? []));
    await this.creation.discard(removed);
    return this.get(conversationId);
  }

  /** Starts a generation of a message that waited for a duration or a voice. */
  async confirmGeneration(messageId: string, generationId: string, choice: ConfirmBody): Promise<ChatGeneration> {
    const message = await this.store.getMessage(messageId);
    if (!message) throw new NotFoundException(tr('chat.error.messageNotFound'));
    await this.store.requireConversation(message.conversationId);
    return this.creation.confirm(message.conversationId, messageId, generationId, choice);
  }

  /** The complete siblings of a message (a comparison of answers shows them side by side). */
  async siblings(conversationId: string, messageId: string): Promise<ChatMessage[]> {
    await this.store.requireConversation(conversationId);
    return this.store.siblings(conversationId, messageId);
  }

  /** Unloads the chat model from memory; refused (409 `busy`) while a reply or a prompt improvement holds the engine. */
  async unloadModel(): Promise<{ ok: true }> {
    if (this.gate.busy) {
      throw new ConflictException({ statusCode: 409, message: tr('chat.error.busyUnload'), code: 'busy' });
    }
    try {
      await this.engine.post('/engine/v1/llm/unload');
    } catch (error) {
      throw engineErrorToHttp(error);
    }
    return { ok: true };
  }

  async export(conversationId: string, format: ExportFormat): Promise<{ body: string; fileName: string; contentType: string }> {
    const { conversation, settings, messages } = await this.get(conversationId);
    const fileName = exportFileName(conversation.title, format);
    return format === 'md'
      ? { body: toMarkdown(conversation, settings, messages), fileName, contentType: 'text/markdown; charset=utf-8' }
      : { body: toJson(conversation, settings, messages), fileName, contentType: 'application/json; charset=utf-8' };
  }

  search(q: string) {
    return this.store.search(q);
  }
}
