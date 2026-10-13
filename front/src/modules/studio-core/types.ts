/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Conversation } from '@/modules/studio-shell/types'

/** Message states (machine described in back/src/modules/studio-core/README.md). */
export type MessageStatus = 'queued' | 'loading' | 'running' | 'done' | 'error' | 'cancelled'

export type AssetMedia = 'image' | 'audio' | 'video'

/** Public shape of an asset (`/api/assets`, same as the legacy API). */
export interface Asset {
  id: string
  kind: 'upload' | 'generated'
  media: AssetMedia
  /** Seconds (audio, video). */
  duration: number | null
  fps?: number | null
  url: string
  thumb_url: string
  width: number | null
  height: number | null
  seed: number | null
  original_name: string | null
  favorite: boolean
  meta: Record<string, unknown>
  conversation_id: string | null
  message_id: string | null
  created_at: number
  /** Gallery results only. */
  conversation_title?: string | null
  prompt?: string | null
  model_id?: string | null
}

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

export interface AssetPage {
  items: Asset[]
  next_before: number | null
}
