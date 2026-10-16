/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConversationEntity, ConversationService, MessageService, type MessageDto } from 'src/modules/studio-core';
import { newId, nowSeconds } from 'src/modules/media-library';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import { siblingGroups, toChatMessage, toChatSettings } from '../mappers/chatMapper';
import type { ChatMessage, ChatSettings, ChatSettingsPatch, ChatStats, ChatStatus, StoredAttachment, StoredGeneration, ToolRun } from '../types/chatTypes';
import { SEARCH_LIMIT, type ChatRole } from '../types/chatTypes';

export interface NewChatMessage {
  conversationId: string;
  parentId: string | null;
  role: ChatRole;
  content?: string;
  attachments?: StoredAttachment[];
  generations?: StoredGeneration[] | null;
  modelId?: string | null;
  params?: Record<string, unknown> | null;
  status?: ChatStatus;
}

/** Mutable fields of a message (what a reply writes while it streams and when it ends). */
export interface ChatMessageUpdate {
  content?: string;
  reasoning?: string | null;
  toolRuns?: ToolRun[];
  generations?: StoredGeneration[] | null;
  status?: ChatStatus;
  error?: string | null;
  stats?: ChatStats | null;
  modelId?: string | null;
}

const CHUNK = 400;
let lastTimestamp = 0;
/** Epoch seconds that never go back or repeat inside the process: messages created in the same millisecond stay in creation order. */
function nextTimestamp(): number {
  lastTimestamp = Math.max(nowSeconds(), lastTimestamp + 0.000001);
  return lastTimestamp;
}
/** LIKE pattern of a substring: `%`, `_` and the escape character are taken literally. */
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Persistence of the chat: the message tree and the per-conversation settings. The active branch is the path from the
 * root to `leaf_id`; replying, editing and regenerating add children, never rewrite a message that was answered.
 */
@Injectable()
export class ChatStoreService {
  constructor(
    @InjectRepository(ChatMessageEntity) private readonly messages: Repository<ChatMessageEntity>,
    @InjectRepository(ChatSettingsEntity) private readonly settings: Repository<ChatSettingsEntity>,
    @InjectRepository(ConversationEntity) private readonly conversations: Repository<ConversationEntity>,
    private readonly conversationService: ConversationService,
    @Optional() private readonly studioMessages?: MessageService,
  ) {}

  /** The conversation row; 404 when it does not exist or is not a chat conversation. */
  async requireConversation(id: string): Promise<ConversationEntity> {
    const conversation = await this.conversations.findOneBy({ id });
    if (!conversation || conversation.mode !== 'chat') throw new NotFoundException('Conversation introuvable.');
    return conversation;
  }

  // Settings -----------------------------------------------------------------------------------------------------

  async getSettings(conversationId: string): Promise<ChatSettings> {
    return toChatSettings(await this.settings.findOneBy({ conversationId }));
  }

  async updateSettings(conversationId: string, patch: ChatSettingsPatch): Promise<ChatSettings> {
    const row = (await this.settings.findOneBy({ conversationId })) ?? this.settings.create({ conversationId, ...this.defaults() });
    if (patch.model_id !== undefined) row.modelId = patch.model_id;
    if (patch.system_prompt !== undefined) row.systemPrompt = patch.system_prompt;
    if (patch.params !== undefined) row.params = patch.params;
    if (patch.context_size !== undefined) row.contextSize = patch.context_size;
    if (patch.reasoning !== undefined) row.reasoning = patch.reasoning;
    if (patch.tools !== undefined) row.tools = { ...row.tools, ...patch.tools };
    await this.settings.save(row);
    return toChatSettings(row);
  }

  async setLeaf(conversationId: string, leafId: string | null): Promise<void> {
    const row = (await this.settings.findOneBy({ conversationId })) ?? this.settings.create({ conversationId, ...this.defaults() });
    row.leafId = leafId;
    await this.settings.save(row);
  }

  private defaults(): Pick<ChatSettingsEntity, 'modelId' | 'systemPrompt' | 'params' | 'contextSize' | 'reasoning' | 'tools' | 'leafId'> {
    return { modelId: null, systemPrompt: '', params: {}, contextSize: null, reasoning: 'auto', tools: { web: false, creation: true }, leafId: null };
  }

  // Messages -----------------------------------------------------------------------------------------------------

  async addMessage(input: NewChatMessage): Promise<ChatMessageEntity> {
    return this.messages.save(
      this.messages.create({
        id: newId(),
        conversationId: input.conversationId,
        parentId: input.parentId,
        role: input.role,
        content: input.content ?? '',
        reasoning: null,
        toolRuns: [],
        generations: input.generations ?? null,
        attachments: input.attachments ?? [],
        modelId: input.modelId ?? null,
        params: input.params ?? null,
        status: input.status ?? 'done',
        error: null,
        stats: null,
        createdAt: nextTimestamp(),
      }),
    );
  }

  async getMessage(id: string): Promise<ChatMessageEntity | null> {
    return this.messages.findOneBy({ id });
  }

  /** A message of this conversation; 404 otherwise (an id of another conversation never matches). */
  async requireMessage(conversationId: string, id: string): Promise<ChatMessageEntity> {
    const message = await this.messages.findOneBy({ id, conversationId });
    if (!message) throw new NotFoundException('Message introuvable.');
    return message;
  }

  async updateMessage(id: string, fields: ChatMessageUpdate): Promise<void> {
    await this.messages.update({ id }, fields);
  }

  /** Every message of the conversation, oldest first. */
  async all(conversationId: string): Promise<ChatMessageEntity[]> {
    return this.messages.find({ where: { conversationId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  /** The messages from the root to `leafId` (empty without a leaf). */
  async path(conversationId: string, leafId: string | null): Promise<ChatMessageEntity[]> {
    return pathTo(await this.all(conversationId), leafId);
  }

  /** The most recent descendant of `messageId` (itself when it has no child): where switching to a branch lands. */
  async latestLeafUnder(conversationId: string, messageId: string): Promise<string> {
    return latestLeaf(await this.all(conversationId), messageId);
  }

  /** The conversation as the browser reads it: settings and the active branch. */
  async branch(conversationId: string): Promise<{ settings: ChatSettings; messages: ChatMessage[] }> {
    const [settings, all] = await Promise.all([this.getSettings(conversationId), this.all(conversationId)]);
    const groups = siblingGroups(all);
    const path = pathTo(all, settings.leaf_id);
    const live = await this.liveGenerations(path);
    return { settings, messages: path.map((m) => toChatMessage(m, groups, live)) };
  }

  /** The siblings of a message (same parent and role, itself included), complete, oldest first: what a comparison shows. */
  async siblings(conversationId: string, messageId: string): Promise<ChatMessage[]> {
    const all = await this.all(conversationId);
    const target = all.find((m) => m.id === messageId);
    if (!target) throw new NotFoundException('Message introuvable.');
    const groups = siblingGroups(all);
    const ids = groups.get(`${target.parentId ?? ''}|${target.role}`) ?? [target.id];
    const byId = new Map(all.map((m) => [m.id, m]));
    const live = await this.liveGenerations(ids.flatMap((id) => byId.get(id) ?? []));
    return ids.flatMap((id) => (byId.has(id) ? [toChatMessage(byId.get(id) as ChatMessageEntity, groups, live)] : []));
  }

  /** One message in its public form (its siblings are read from the conversation). */
  async toDto(entity: ChatMessageEntity): Promise<ChatMessage> {
    return toChatMessage(entity, siblingGroups(await this.all(entity.conversationId)), await this.liveGenerations([entity]));
  }

  /** The `studio-core` messages (state and files) behind the generations of these chat messages, by id. */
  private async liveGenerations(messages: ChatMessageEntity[]): Promise<Map<string, MessageDto>> {
    const ids = messages.flatMap((m) => (m.generations ?? []).flatMap((g) => (g.message_id ? [g.message_id] : [])));
    if (!ids.length || !this.studioMessages) return new Map();
    const rows = (await Promise.all(ids.map((id) => this.studioMessages?.get(id)))).filter((m): m is MessageDto => Boolean(m));
    return new Map(rows.map((m) => [m.id, m]));
  }

  /**
   * Deletes a message and its whole subtree. Returns what was deleted (the caller removes their files) and moves the
   * leaf when it was among them: to the latest branch of the previous sibling, else to the parent.
   */
  async deleteSubtree(conversationId: string, messageId: string): Promise<ChatMessageEntity[]> {
    const all = await this.all(conversationId);
    const target = all.find((m) => m.id === messageId);
    if (!target) throw new NotFoundException('Message introuvable.');
    const doomed = descendantsOf(all, messageId);
    const gone = new Set(doomed.map((m) => m.id));
    const leaf = (await this.getSettings(conversationId)).leaf_id;
    if (leaf && gone.has(leaf)) {
      const remaining = siblingGroups(all.filter((m) => !gone.has(m.id))).get(`${target.parentId ?? ''}|${target.role}`) ?? [];
      const heir = remaining.length ? latestLeaf(all, remaining[remaining.length - 1]) : target.parentId;
      await this.setLeaf(conversationId, heir);
    }
    const ids = doomed.map((m) => m.id);
    for (let i = 0; i < ids.length; i += CHUNK) await this.messages.delete({ id: In(ids.slice(i, i + CHUNK)) });
    return doomed;
  }

  /** At startup: a reply still `streaming` belongs to a run that stopped. Its text is kept, the state says what happened. */
  async failInterrupted(): Promise<number> {
    const stuck = await this.messages.find({ where: { status: 'streaming' }, select: ['id'] });
    if (!stuck.length) return 0;
    await this.messages.update({ id: In(stuck.map((m) => m.id)) }, { status: 'error', error: "Réponse interrompue par l'arrêt de l'application." });
    return stuck.length;
  }

  // What the shared conversation code asks of the chat (registered by `ChatBootstrap`) -----------------------------------

  async stats(conversationId: string): Promise<{ generationCount: number; busy: boolean }> {
    const all = await this.all(conversationId);
    const leaf = (await this.getSettings(conversationId)).leaf_id;
    return { generationCount: pathTo(all, leaf).length, busy: all.some((m) => m.status === 'streaming') };
  }

  async matching(q: string): Promise<string[]> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .select('DISTINCT m.conversation_id', 'id')
      .where("m.content LIKE :q ESCAPE '\\'", { q: likePattern(q) })
      .limit(500)
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /** Names of every attachment some message still uses (the start-up sweep keeps those). */
  async referencedAttachments(): Promise<Set<string>> {
    const rows = await this.messages.find({ select: ['id', 'attachments'] });
    return new Set(rows.flatMap((m) => (m.attachments ?? []).map((a) => a.name)));
  }

  /** Full-text search over every chat message (the route `GET /api/chat/search`). */
  async search(q: string): Promise<{ conversation_id: string; message_id: string; snippet: string }[]> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .where("m.content LIKE :q ESCAPE '\\'", { q: likePattern(q) })
      .orderBy('m.createdAt', 'DESC')
      .limit(SEARCH_LIMIT)
      .getMany();
    return rows.map((m) => ({ conversation_id: m.conversationId, message_id: m.id, snippet: snippetAround(m.content, q) }));
  }

  /** Makes the conversation the most recent of the list. */
  touch(conversationId: string): Promise<void> {
    return this.conversationService.touch(conversationId);
  }
}

/** The path from the root to `leafId` through `parentId` links. */
export function pathTo(all: ChatMessageEntity[], leafId: string | null): ChatMessageEntity[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const path: ChatMessageEntity[] = [];
  const seen = new Set<string>();
  for (let cur = leafId ? byId.get(leafId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    path.push(cur);
  }
  return path.reverse();
}

export function descendantsOf(all: ChatMessageEntity[], rootId: string): ChatMessageEntity[] {
  const children = new Map<string, ChatMessageEntity[]>();
  for (const m of all) if (m.parentId) children.set(m.parentId, [...(children.get(m.parentId) ?? []), m]);
  const out: ChatMessageEntity[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    const self = all.find((m) => m.id === id);
    if (self) out.push(self);
    for (const child of children.get(id) ?? []) queue.push(child.id);
  }
  return out;
}

export function latestLeaf(all: ChatMessageEntity[], fromId: string): string {
  let current = fromId;
  for (;;) {
    const kids = all.filter((m) => m.parentId === current);
    if (!kids.length) return current;
    current = kids.reduce((a, b) => (b.createdAt > a.createdAt || (b.createdAt === a.createdAt && b.id > a.id) ? b : a)).id;
  }
}

/** About 120 characters around the first occurrence of `q` (case-insensitive), with ellipses. */
export function snippetAround(content: string, q: string): string {
  const at = Math.max(0, content.toLowerCase().indexOf(q.toLowerCase()));
  const start = Math.max(0, at - 50);
  const end = Math.min(content.length, at + q.length + 70);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`;
}
