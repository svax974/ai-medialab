/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { AssetDto } from 'src/modules/media-library';
import type { ConversationDto, MessageStatus } from 'src/modules/studio-core';

/** Public and internal shapes of the chat studio (module `chat`). Public ones are the contract with the front. */

export type ChatRole = 'user' | 'assistant';
export type ChatStatus = 'done' | 'streaming' | 'error' | 'cancelled';
export type ChatReasoning = 'auto' | 'off' | 'low' | 'medium' | 'high';

/** What the browser sees of an attachment (`url`: preview served by `/api/media`, images only). */
export interface ChatAttachment {
  kind: 'image' | 'text';
  /** Name of the stored file: what `POST .../messages` takes back. */
  name: string;
  /** Name of the file the user picked (additive to the contract: the interface shows it). */
  original_name: string;
  mime: string;
  size: number;
  url?: string;
}

export interface ToolRun {
  id: string;
  name: 'web_search' | 'fetch_url' | 'generate_image' | 'generate_video' | 'generate_audio';
  arguments: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result_preview?: string;
  sources?: { title: string; url: string }[];
}

export type CreationKind = 'image' | 'video' | 'audio';
/** What a generation of the chat waits for before it can start: a duration (video) or a voice (audio model that needs one). */
export type GenerationPending = 'duration' | 'voice';

/** A generation of a message as stored (column `generations`): the file and its state live in `studio-core`, read back by `message_id`. */
export interface StoredGeneration {
  id: string;
  kind: CreationKind;
  model_id: string;
  /** The `studio-core` message that runs it; `null` while it waits for the user (`pending`). */
  message_id: string | null;
  /** What was asked (the text to generate / to read aloud). */
  prompt: string;
  params: Record<string, unknown>;
  pending?: GenerationPending;
}

/** A generation as the browser sees it: the stored entry plus the live state and the produced files. */
export interface ChatGeneration extends StoredGeneration {
  state: 'pending' | MessageStatus;
  error: string | null;
  assets: AssetDto[];
  /** Id of the studio conversation-less origin: the chat conversation that owns the files. */
  conversation_id: string;
}

/** Models the studios have selected, sent with every message: the chat offers the creation tool of each. */
export interface CreationModels {
  image?: string;
  video?: string;
  audio?: string;
}

export interface ChatStats {
  prompt_tokens: number;
  completion_tokens: number;
  tokens_per_second: number | null;
  context_size: number | null;
  elapsed_ms: number;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: ChatRole;
  content: string;
  reasoning: string | null;
  tool_runs: ToolRun[];
  generations: ChatGeneration[];
  attachments: ChatAttachment[];
  model_id: string | null;
  params: Record<string, unknown> | null;
  status: ChatStatus;
  error: string | null;
  /** `memory`: the free-memory check refused the load; regenerate with `force_memory` to go on anyway. */
  error_code: string | null;
  stats: ChatStats | null;
  /** Epoch seconds. */
  created_at: number;
  /** Messages with the same parent and role (this one included), oldest first. */
  sibling_ids: string[];
  sibling_index: number;
}

export interface ChatParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  seed?: number | null;
  stop?: string[];
}

export interface ChatSettings {
  model_id: string | null;
  system_prompt: string;
  params: ChatParams;
  context_size: number | null;
  reasoning: ChatReasoning;
  tools: { web: boolean; creation: boolean };
  /** Last message of the active branch. */
  leaf_id: string | null;
}

export type ChatSettingsPatch = Partial<Omit<ChatSettings, 'leaf_id' | 'tools'>> & { tools?: Partial<ChatSettings['tools']> };

export interface ChatConversation {
  conversation: ConversationDto;
  settings: ChatSettings;
  /** The active branch, root to leaf. */
  messages: ChatMessage[];
}

/** An attachment as stored in the message row: the public fields plus nothing the browser must not know. */
export type StoredAttachment = Omit<ChatAttachment, 'url'>;

export type ChatErrorCode = 'busy' | 'no_model' | 'no_engine' | 'context_exceeded' | 'refused' | 'upstream' | 'closed' | 'invalid' | 'memory';

/** A failure that ends a reply: `code` is the one of the SSE `error` event. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  model_id: null,
  system_prompt: '',
  params: {},
  context_size: null,
  reasoning: 'auto',
  tools: { web: false, creation: true },
  leaf_id: null,
};

export const MAX_CONTENT_CHARS = 200_000;
export const MAX_SYSTEM_PROMPT_CHARS = 20_000;
export const MAX_ATTACHMENTS = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Rounds of tool calls in one reply (each round may call several tools). */
export const MAX_TOOL_ROUNDS = 5;
/** Longest title generated for a conversation. */
export const MAX_TITLE_CHARS = 80;
export const SEARCH_LIMIT = 50;
