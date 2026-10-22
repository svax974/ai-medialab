/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import type { ConversationDetailDto, ConversationDto, MessageDto, MessageStatus } from 'src/modules/studio-core';
import { BUSY_STATUSES } from 'src/modules/studio-core';
import { newId, nowSeconds } from 'src/modules/media-library';
import type { AssetDto } from 'src/modules/media-library';
import {
  toPrivateAssetDto, toPrivateConversationDetail, toPrivateConversationDto, toPrivateMessageDto, type PrivateStats,
} from './privateMappers';
import type { PrivateAsset, PrivateConversation, PrivateMessage } from '../types/privateTypes';

export interface NewPrivateMessage {
  id?: string;
  conversationId: string;
  role: PrivateMessage['role'];
  parentId?: string | null;
  prompt?: string;
  modelId?: string | null;
  params?: Record<string, unknown>;
  status?: MessageStatus;
  createdAt?: number;
  referenceIds?: string[];
}

/**
 * What a private session knows: its conversations, messages and assets, in this process's memory and nowhere else
 * (no database, no file but the media themselves, which are in the session folder). `clear()` forgets everything.
 */
@Injectable()
export class PrivateStore {
  private sessionId: string | null = null;
  private conversations = new Map<string, PrivateConversation>();
  private messages = new Map<string, PrivateMessage>();
  private assets = new Map<string, PrivateAsset>();
  private refs = new Map<string, string[]>();

  bind(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  clear(): void {
    this.sessionId = null;
    this.conversations = new Map();
    this.messages = new Map();
    this.assets = new Map();
    this.refs = new Map();
  }

  get sid(): string {
    if (!this.sessionId) throw new Error('no private session');
    return this.sessionId;
  }

  counts(): { conversations: number; results: number } {
    const results = [...this.assets.values()].filter((a) => a.kind === 'generated').length;
    return { conversations: this.conversations.size, results };
  }

  // Conversations ----------------------------------------------------------------------------------------------------

  createConversation(input: { title: string; mode: PrivateConversation['mode'] }): PrivateConversation {
    const now = nowSeconds();
    const conversation: PrivateConversation = { id: newId(), title: input.title, pinned: false, mode: input.mode, createdAt: now, updatedAt: now };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  getConversation(id: string): PrivateConversation | null {
    return this.conversations.get(id) ?? null;
  }

  touch(id: string): void {
    const conversation = this.conversations.get(id);
    if (conversation) conversation.updatedAt = nowSeconds();
  }

  updateConversation(id: string, fields: Partial<Pick<PrivateConversation, 'title' | 'pinned' | 'messageCount'>>): PrivateConversation | null {
    const conversation = this.conversations.get(id);
    if (conversation) Object.assign(conversation, fields);
    return conversation ?? null;
  }

  /** Forgets a conversation, its messages and its assets; returns the assets (their files are the caller's to delete). */
  deleteConversation(id: string): PrivateAsset[] {
    const assets = this.assetsOfConversation(id);
    for (const message of this.listMessages(id)) this.messages.delete(message.id);
    for (const asset of assets) this.assets.delete(asset.id);
    this.conversations.delete(id);
    return assets;
  }

  // Messages ---------------------------------------------------------------------------------------------------------

  createMessage(input: NewPrivateMessage): PrivateMessage {
    const message: PrivateMessage = {
      id: input.id ?? newId(), conversationId: input.conversationId, parentId: input.parentId ?? null, role: input.role,
      prompt: input.prompt ?? '', modelId: input.modelId ?? null, params: input.params ?? {}, status: input.status ?? 'done',
      error: null, createdAt: input.createdAt ?? nowSeconds(), startedAt: null, finishedAt: null,
    };
    this.messages.set(message.id, message);
    const refIds = [...new Set(input.referenceIds ?? [])];
    if (refIds.length) this.refs.set(message.id, refIds);
    return message;
  }

  getMessage(id: string): PrivateMessage | null {
    return this.messages.get(id) ?? null;
  }

  updateMessage(id: string, fields: Partial<Omit<PrivateMessage, 'id'>>): PrivateMessage | null {
    const message = this.messages.get(id);
    if (message) Object.assign(message, fields);
    return message ?? null;
  }

  listMessages(conversationId: string): PrivateMessage[] {
    return [...this.messages.values()].filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  childIds(parentId: string): string[] {
    return [...this.messages.values()].filter((m) => m.parentId === parentId).map((m) => m.id);
  }

  busyIds(conversationId: string): string[] {
    return this.listMessages(conversationId).filter((m) => BUSY_STATUSES.includes(m.status)).map((m) => m.id);
  }

  /** Forgets these messages; returns the assets that went with them (outputs, and the references nothing else uses). */
  removeMessages(ids: string[]): PrivateAsset[] {
    const gone = new Set(ids);
    const candidates = new Map<string, PrivateAsset>();
    for (const id of ids) {
      for (const asset of this.outputsOf(id)) candidates.set(asset.id, asset);
      for (const asset of this.referencesOf(id)) candidates.set(asset.id, asset);
      this.messages.delete(id);
      this.refs.delete(id);
    }
    const stillUsed = new Set([...this.refs.entries()].filter(([mid]) => !gone.has(mid)).flatMap(([, list]) => list));
    const removed = [...candidates.values()].filter((a) => a.kind === 'generated' || !stillUsed.has(a.id));
    for (const asset of removed) this.assets.delete(asset.id);
    return removed;
  }

  // Assets -----------------------------------------------------------------------------------------------------------

  addAsset(asset: Omit<PrivateAsset, 'createdAt' | 'favorite'> & { createdAt?: number }): PrivateAsset {
    const stored: PrivateAsset = { ...asset, favorite: false, createdAt: asset.createdAt ?? nowSeconds() };
    this.assets.set(stored.id, stored);
    return stored;
  }

  getAsset(id: string): PrivateAsset | null {
    return this.assets.get(id) ?? null;
  }

  setFavorite(id: string, favorite: boolean): PrivateAsset | null {
    const asset = this.assets.get(id);
    if (asset) asset.favorite = favorite;
    return asset ?? null;
  }

  removeAsset(id: string): PrivateAsset | null {
    const asset = this.assets.get(id) ?? null;
    this.assets.delete(id);
    return asset;
  }

  /** Uploads not used by any message yet are attached to the conversation of their first use. */
  adopt(ids: string[], conversationId: string): void {
    for (const id of ids) {
      const asset = this.assets.get(id);
      if (asset && !asset.conversationId) asset.conversationId = conversationId;
    }
  }

  referencesOf(messageId: string): PrivateAsset[] {
    return (this.refs.get(messageId) ?? []).map((id) => this.assets.get(id)).filter((a): a is PrivateAsset => Boolean(a));
  }

  outputsOf(messageId: string): PrivateAsset[] {
    return [...this.assets.values()].filter((a) => a.messageId === messageId && a.kind === 'generated').sort((a, b) => a.position - b.position);
  }

  assetsOfConversation(conversationId: string): PrivateAsset[] {
    return [...this.assets.values()].filter((a) => a.conversationId === conversationId);
  }

  /** Every file name the session holds (to erase them, or to prove that nothing else is left). */
  allAssets(): PrivateAsset[] {
    return [...this.assets.values()];
  }

  // Public shapes ----------------------------------------------------------------------------------------------------

  assetDto(asset: PrivateAsset): AssetDto {
    return toPrivateAssetDto(asset, this.sid);
  }

  messageDto(message: PrivateMessage): MessageDto {
    return toPrivateMessageDto(message, this.referencesOf(message.id), this.outputsOf(message.id), this.sid);
  }

  private stats(conversation: PrivateConversation): PrivateStats {
    const assistants = this.listMessages(conversation.id).filter((m) => m.role === 'assistant');
    const cover = this.assetsOfConversation(conversation.id)
      .filter((a) => a.kind === 'generated' && a.media !== 'audio').sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return { cover, generationCount: conversation.messageCount ?? assistants.length, busy: assistants.some((m) => BUSY_STATUSES.includes(m.status)) };
  }

  summary(id: string): ConversationDto | null {
    const conversation = this.conversations.get(id);
    return conversation ? toPrivateConversationDto(conversation, this.stats(conversation), this.sid) : null;
  }

  detail(id: string): ConversationDetailDto | null {
    const conversation = this.conversations.get(id);
    if (!conversation) return null;
    return toPrivateConversationDetail(conversation, this.stats(conversation), this.listMessages(id).map((m) => this.messageDto(m)), this.sid);
  }

  list(query: { q?: string; mode?: PrivateConversation['mode'] } = {}): ConversationDto[] {
    const q = query.q?.toLowerCase();
    return [...this.conversations.values()]
      .filter((c) => (!query.mode || c.mode === query.mode)
        && (!q || c.title.toLowerCase().includes(q) || this.listMessages(c.id).some((m) => m.prompt.toLowerCase().includes(q))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
      .map((c) => toPrivateConversationDto(c, this.stats(c), this.sid));
  }
}
