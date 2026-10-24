/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import type { ConversationMode } from '../entities/ConversationEntity';
import type { MessageRole, MessageStatus } from '../entities/MessageEntity';

/** Default titles are stored as written: `DEFAULT_*` is the French value (kept for code that compares), `isDefault*Title` accepts both languages. */
export const DEFAULT_CONVERSATION_TITLE = tr('studioCore.title.defaultConversation', [], 'fr');
export const defaultConversationTitle = (): string => tr('studioCore.title.defaultConversation');
export const isDefaultConversationTitle = (title: unknown): boolean =>
  title === tr('studioCore.title.defaultConversation', [], 'fr') || title === tr('studioCore.title.defaultConversation', [], 'en');
/** Title of a conversation of the chat studio until its first exchange names it. */
export const DEFAULT_CHAT_TITLE = tr('studioCore.title.defaultChat', [], 'fr');
export const defaultChatTitle = (): string => tr('studioCore.title.defaultChat');
export const isDefaultChatTitle = (title: unknown): boolean =>
  title === tr('studioCore.title.defaultChat', [], 'fr') || title === tr('studioCore.title.defaultChat', [], 'en');
export const MAX_TITLE_LENGTH = 200;
/** Statuses of a generation that is still going (the legacy `busy` flag and the interruption sweep). */
export const BUSY_STATUSES: MessageStatus[] = ['queued', 'loading', 'running'];

export interface CreateConversationInput {
  /** Trimmed; empty or missing gives `Nouvelle création`. */
  title?: string;
  /** Anything other than audio / video / chat gives `image`. */
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
  errorCode?: string | null;
  params?: Record<string, unknown>;
  modelId?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
}
