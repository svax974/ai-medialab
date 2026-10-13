/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { ConversationMode } from '../entities/ConversationEntity';
import type { MessageRole, MessageStatus } from '../entities/MessageEntity';

export const DEFAULT_CONVERSATION_TITLE = 'Nouvelle création';
export const MAX_TITLE_LENGTH = 200;
/** Statuses of a generation that is still going (the legacy `busy` flag and the interruption sweep). */
export const BUSY_STATUSES: MessageStatus[] = ['queued', 'loading', 'running'];

export interface CreateConversationInput {
  /** Trimmed; empty or missing gives `Nouvelle création`. */
  title?: string;
  /** Anything other than audio / video gives `image`. */
  mode?: string;
}

export interface UpdateConversationInput {
  /** Trimmed and cut to 200 characters. */
  title?: string;
  pinned?: boolean;
}

export interface ListConversationsQuery {
  /** Substring of the title or of any prompt of the conversation. */
  q?: string;
  mode?: ConversationMode;
}

export interface CreateMessageInput {
  id: string;
  conversationId: string;
  role: MessageRole;
  parentId?: string | null;
  prompt?: string;
  modelId?: string | null;
  params?: Record<string, unknown>;
  status?: MessageStatus;
  createdAt?: number;
  /** Reference assets, in display order (duplicates are ignored). */
  referenceIds?: string[];
}

/** Mutable fields of a message (what the job runner updates). */
export interface UpdateMessageInput {
  status?: MessageStatus;
  error?: string | null;
  params?: Record<string, unknown>;
  modelId?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
}
