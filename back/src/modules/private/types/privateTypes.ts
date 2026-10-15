/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { AssetKind, AssetMedia } from 'src/modules/media-library';
import type { ConversationMode, MessageRole, MessageStatus } from 'src/modules/studio-core';

/** Who holds the engine gauge while a private generation runs (shared with the chat and the normal queue). */
export const PRIVATE_OWNER = 'private';
/** Minutes without any request after which the session is erased (0 disables it). `PRIVATE_SESSION_TTL_MINUTES` overrides. */
export const DEFAULT_TTL_MINUTES = 30;
/** Title of a private conversation that has no prompt yet. */
export const PRIVATE_DEFAULT_TITLE = 'Création privée';
/** Title of a private chat conversation: it is never made from what was said (the browser holds the conversation). */
export const PRIVATE_CHAT_TITLE = 'Conversation privée';

/** An asset of the session: same fields as the stored one, held in memory only. */
export interface PrivateAsset {
  id: string;
  kind: AssetKind;
  media: AssetMedia;
  filename: string;
  thumb: string | null;
  originalName: string | null;
  width: number | null;
  height: number | null;
  seed: number | null;
  duration: number | null;
  position: number;
  favorite: boolean;
  meta: Record<string, unknown>;
  conversationId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface PrivateMessage {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: MessageRole;
  prompt: string;
  modelId: string | null;
  params: Record<string, unknown>;
  status: MessageStatus;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface PrivateConversation {
  id: string;
  title: string;
  pinned: boolean;
  mode: ConversationMode;
  createdAt: number;
  updatedAt: number;
  /** Chat only: how many messages the browser's conversation holds (a number, shown in the list; the content is the browser's). */
  messageCount?: number;
}

/** What `GET /api/private/session` tells (no content, only what the banner needs). */
export interface PrivateSessionInfo {
  active: boolean;
  created_at: number | null;
  last_activity: number | null;
  /** Epoch seconds at which the inactivity timeout erases the session, or null without a timeout. */
  expires_at: number | null;
  conversations: number;
  /** Results (files) the session holds: the browser warns before closing while there are some. */
  results: number;
}
