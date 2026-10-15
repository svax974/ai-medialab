/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ConversationSummary } from '@/modules/studio-shell/types'

/** Public shapes of the Nest `chat` module (`back/src/modules/chat/README.md`): JSON in snake_case, times in epoch seconds. */
export type ChatRole = 'user' | 'assistant'
export type ChatStatus = 'done' | 'streaming' | 'error' | 'cancelled'

export interface ChatAttachment {
  kind: 'image' | 'text'
  /** Name of the stored file: what a send or an edit takes back. */
  name: string
  /** Name of the file the user picked: what the interface shows (`displayName`). */
  original_name: string
  mime: string
  size: number
  /** Preview served by `/api/media` (images). */
  url?: string
}

/** A tool call of an answer, as the interface shows it (the query really sent is in `arguments`). */
export interface ToolRun {
  id: string
  name: 'web_search' | 'fetch_url'
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result_preview?: string
  sources?: { title: string; url: string }[]
}

export interface ChatStats {
  prompt_tokens: number
  completion_tokens: number
  tokens_per_second: number | null
  context_size: number | null
  elapsed_ms: number
}

export interface ChatMessage {
  id: string
  conversation_id: string
  parent_id: string | null
  role: ChatRole
  content: string
  reasoning: string | null
  tool_runs: ToolRun[]
  attachments: ChatAttachment[]
  model_id: string | null
  params: Record<string, unknown> | null
  status: ChatStatus
  error: string | null
  stats: ChatStats | null
  created_at: number
  /** Siblings (same parent and role) in creation order, itself included. */
  sibling_ids: string[]
  sibling_index: number
}

export type ReasoningLevel = 'auto' | 'off' | 'low' | 'medium' | 'high'

export interface SamplingParams {
  temperature?: number
  top_p?: number
  top_k?: number
  min_p?: number
  repeat_penalty?: number
  presence_penalty?: number
  frequency_penalty?: number
  max_tokens?: number
  seed?: number | null
  stop?: string[]
}

export interface ChatSettings {
  model_id: string | null
  system_prompt: string
  params: SamplingParams
  context_size: number | null
  reasoning: ReasoningLevel
  /** Web search (DuckDuckGo, or Brave when a key is saved in the settings): the queries leave the machine. */
  tools: { web: boolean }
  /** Last message of the active branch. */
  leaf_id: string | null
}

/** Settings a PATCH may change (the leaf moves through `/leaf`). */
export type ChatSettingsPatch = Partial<Omit<ChatSettings, 'leaf_id'>>

/** `GET /api/chat/conversations/:id`: the conversation, its settings and the messages of the active branch (root to leaf). */
export interface ChatConversation {
  conversation: ConversationSummary
  settings: ChatSettings
  messages: ChatMessage[]
}

export type ChatErrorCode = 'busy' | 'no_model' | 'no_engine' | 'context_exceeded' | 'refused' | 'upstream' | 'closed' | 'invalid'

/** Events of the answer stream (`event: <type>` + JSON `data`), see the contract. */
export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'loading'; phase: 'starting' | 'loading' | 'ready'; model_id: string; elapsed_s?: number }
  | { type: 'delta'; id: string; content: string }
  | { type: 'reasoning'; id: string; content: string }
  | { type: 'tool'; id: string; run: ToolRun }
  | { type: 'usage'; id: string; stats: ChatStats }
  | { type: 'title'; title: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; code: ChatErrorCode; message: string; id?: string }

export interface ChatSearchHit {
  conversation_id: string
  message_id: string
  snippet: string
}

/** What a send asks: the text, the uploaded files, the branch point and the model. */
export interface SendBody {
  content: string
  attachments?: { name: string }[]
  /** Parent of the new message; absent: the current leaf; `null`: a new root. */
  parent_id?: string | null
  model_id?: string
}

/** The model state the engine reports (`engine.llm.status`). */
export interface LlmStatus {
  state: 'idle' | 'loading' | 'ready' | 'generating'
  model_id: string | null
  variant?: string | null
  context_size: number | null
  vision?: boolean
  started_at?: number | null
  last_error?: string | null
}
