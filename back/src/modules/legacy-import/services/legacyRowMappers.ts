/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { AssetEntity } from 'src/modules/media-library';
import { VoiceEntity } from 'src/modules/audio-studio';
import { ConversationEntity, MessageEntity, MessageRefEntity } from 'src/modules/studio-core';

/** A row of the legacy database: SQLite values by column name. */
export type LegacyRow = Record<string, unknown>;

const MODES = ['image', 'audio', 'video'];
const MESSAGE_STATUSES = ['queued', 'loading', 'running', 'done', 'error', 'cancelled'];

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;

/** JSON column of the legacy database (stored as text); anything unreadable falls back to the empty value. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function toConversation(r: LegacyRow): ConversationEntity {
  return Object.assign(new ConversationEntity(), {
    id: String(r.id),
    title: String(r.title ?? ''),
    pinned: bool(r.pinned),
    mode: MODES.includes(String(r.mode)) ? String(r.mode) : 'image', // `mode` was added after the first release
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });
}

/** `parentId` is cleared by the caller when the parent message does not exist. */
export function toMessage(r: LegacyRow): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    parentId: str(r.parent_id),
    role: r.role === 'assistant' ? 'assistant' : 'user',
    prompt: String(r.prompt ?? ''),
    modelId: str(r.model_id),
    params: parseJson<Record<string, unknown>>(r.params, {}),
    status: MESSAGE_STATUSES.includes(String(r.status)) ? String(r.status) : 'done',
    error: str(r.error),
    createdAt: Number(r.created_at),
    startedAt: num(r.started_at),
    finishedAt: num(r.finished_at),
  });
}

/** `conversationId` / `messageId` are cleared by the caller when they point at a missing row. */
export function toAsset(r: LegacyRow): AssetEntity {
  return Object.assign(new AssetEntity(), {
    id: String(r.id),
    kind: r.kind === 'upload' ? 'upload' : 'generated',
    media: MODES.includes(String(r.media)) ? String(r.media) : 'image', // `media` was added after the first release
    conversationId: str(r.conversation_id),
    messageId: str(r.message_id),
    filename: String(r.filename),
    thumb: str(r.thumb),
    originalName: str(r.original_name),
    width: num(r.width),
    height: num(r.height),
    seed: num(r.seed),
    duration: num(r.duration), // added after the first release
    position: Number(r.position ?? 0),
    favorite: bool(r.favorite),
    meta: parseJson<Record<string, unknown>>(r.meta, {}),
    createdAt: Number(r.created_at),
  });
}

export function toMessageRef(r: LegacyRow): MessageRefEntity {
  return Object.assign(new MessageRefEntity(), {
    messageId: String(r.message_id),
    assetId: String(r.asset_id),
    position: Number(r.position ?? 0),
  });
}

export function toVoice(r: LegacyRow): VoiceEntity {
  return Object.assign(new VoiceEntity(), {
    id: String(r.id),
    name: String(r.name ?? ''),
    kind: r.kind === 'design' ? 'design' : 'clone',
    filename: str(r.filename),
    transcript: String(r.transcript ?? ''),
    description: String(r.description ?? ''),
    language: str(r.language),
    duration: num(r.duration),
    peaks: parseJson<number[]>(r.peaks, []),
    createdAt: Number(r.created_at),
  });
}
