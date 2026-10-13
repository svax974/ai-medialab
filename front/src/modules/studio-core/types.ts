/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Conversation } from '@/modules/studio-shell/types'

/** Message states (machine described in back/src/modules/studio-core/README.md). */
export type MessageStatus = 'queued' | 'loading' | 'running' | 'done' | 'error' | 'cancelled'

export type { Asset, AssetMedia, AssetPage } from '@/modules/media-library/types'
import type { Asset } from '@/modules/media-library/types'

/** Generation parameters of a message (resolved by the engine once the job started). */
export interface GenParams {
  aspect?: string
  megapixels?: number
  width?: number
  height?: number
  steps?: number
  guidance?: number
  strength?: number
  negative_prompt?: string
  seed?: number | null
  seeds?: number[]
  count?: number
  references_used?: number
  [key: string]: unknown
}

/** Public shape of a message (user prompt or assistant generation). */
export interface Message {
  id: string
  conversation_id: string
  parent_id: string | null
  role: 'user' | 'assistant'
  prompt: string
  model_id: string | null
  params: GenParams
  status: MessageStatus
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  references: Asset[]
  outputs: Asset[]
}

export type ConversationDetail = Conversation<Message>

/** `studio.job.progress` payload (merged over time in the live store). */
export interface JobProgress {
  message_id: string
  conversation_id?: string
  phase?: 'loading' | 'running'
  stage?: 'prepare' | 'fetch' | 'sampling' | 'decode' | 'encode' | null
  load_started_at?: number
  index?: number
  count?: number
  step?: number
  total?: number
  eta?: number | null
  seconds_per_step?: number | null
  preview_url?: string | null
}

export interface SendMessageRequest {
  conversation_id: string | null
  prompt: string
  model_id: string
  params: GenParams
  reference_ids: string[]
  count: number
}

export interface SendMessageResponse {
  conversation_id: string
  user_message: Message
  assistant_message: Message
}

export interface RetryRequest {
  keep_seed?: boolean
  params?: GenParams
  model_id?: string
}

/** The generation queue as Nest publishes it (`studio.queue.updated`, `GET /api/queue`): the message being generated and the waiting ones. */
export interface QueueState {
  current: string | null
  /** Waiting messages in order; the running one is not listed. */
  queue: string[]
}
