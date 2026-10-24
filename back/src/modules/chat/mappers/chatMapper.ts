/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { MessageDto } from 'src/modules/studio-core';
import type { ChatMessageEntity } from '../entities/ChatMessageEntity';
import type { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import type { ChatAttachment, ChatGeneration, ChatMessage, ChatSettings, StoredAttachment, StoredGeneration } from '../types/chatTypes';
import { DEFAULT_CHAT_SETTINGS } from '../types/chatTypes';

/** URL of an attachment's file under the media relay (`uploads/` of the data folder is one of the engine's mounts). */
export const attachmentUrl = (name: string): string => `/api/media/uploads/${encodeURIComponent(name)}`;

export function toPublicAttachment(stored: StoredAttachment): ChatAttachment {
  return { ...stored, ...(stored.kind === 'image' ? { url: attachmentUrl(stored.name) } : {}) };
}

/** Messages with the same parent and role, oldest first: what the interface pages through (`‹ 2/3 ›`). */
export function siblingGroups(messages: Pick<ChatMessageEntity, 'id' | 'parentId' | 'role' | 'createdAt'>[]): Map<string, string[]> {
  const groups = new Map<string, Pick<ChatMessageEntity, 'id' | 'createdAt'>[]>();
  for (const m of messages) {
    const key = `${m.parentId ?? ''}|${m.role}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const ordered = new Map<string, string[]>();
  for (const [key, list] of groups) ordered.set(key, list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((m) => m.id));
  return ordered;
}

/** A stored generation with the state and the files of its `studio-core` message (`live`, by message id); `pending` while it waits for the user. */
export function toChatGeneration(stored: StoredGeneration, conversationId: string, live: Map<string, MessageDto>): ChatGeneration {
  const run = stored.message_id ? live.get(stored.message_id) : undefined;
  const state = stored.pending ? 'pending' : run?.status ?? 'cancelled';
  return { ...stored, state, error: run?.error ?? null, assets: run?.outputs ?? [], conversation_id: conversationId };
}

export function toChatMessage(entity: ChatMessageEntity, groups: Map<string, string[]>, live: Map<string, MessageDto> = new Map()): ChatMessage {
  const siblings = groups.get(`${entity.parentId ?? ''}|${entity.role}`) ?? [entity.id];
  return {
    id: entity.id,
    conversation_id: entity.conversationId,
    parent_id: entity.parentId,
    role: entity.role,
    content: entity.content,
    reasoning: entity.reasoning,
    tool_runs: entity.toolRuns ?? [],
    generations: (entity.generations ?? []).map((g) => toChatGeneration(g, entity.conversationId, live)),
    attachments: (entity.attachments ?? []).map(toPublicAttachment),
    model_id: entity.modelId,
    params: entity.params,
    status: entity.status,
    error: entity.error,
    error_code: entity.errorCode ?? null,
    stats: entity.stats,
    created_at: entity.createdAt,
    sibling_ids: siblings,
    sibling_index: Math.max(0, siblings.indexOf(entity.id)),
  };
}

export function toChatSettings(entity: ChatSettingsEntity | null): ChatSettings {
  if (!entity) return { ...DEFAULT_CHAT_SETTINGS, params: {}, tools: { web: false, creation: true } };
  return {
    model_id: entity.modelId,
    system_prompt: entity.systemPrompt,
    params: entity.params ?? {},
    context_size: entity.contextSize,
    reasoning: entity.reasoning,
    tools: { web: Boolean(entity.tools?.web), creation: entity.tools?.creation !== false },
    leaf_id: entity.leafId,
  };
}
