/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ConversationSummary } from '@/modules/studio-shell/types'
import type { ChatConversation, ChatMessage, ChatSettings } from '../types'

/** Builders for the specs: a message, a conversation and its settings, with the fields a test does not care about filled in. */
export const message = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversation_id: 'c1',
  parent_id: null,
  role: 'user',
  content: '',
  reasoning: null,
  tool_runs: [],
  generations: [],
  attachments: [],
  model_id: null,
  params: null,
  status: 'done',
  error: null,
  stats: null,
  created_at: 1_700_000_000,
  sibling_ids: [id],
  sibling_index: 0,
  ...extra,
})

export const settings = (extra: Partial<ChatSettings> = {}): ChatSettings => ({ model_id: null, system_prompt: '', params: {}, context_size: null, reasoning: 'auto', tools: { web: false, creation: true }, leaf_id: null, ...extra })

export const summary: ConversationSummary = { id: 'c1', mode: 'chat', title: 'Bonjour', pinned: false, created_at: 1_700_000_000, updated_at: 1_700_000_100, cover: null, generation_count: 0, busy: false }

export const conversation = (messages: ChatMessage[] = [], extra: Partial<ChatSettings> = {}): ChatConversation => ({ conversation: summary, settings: settings(extra), messages })
