/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Mode of the studio: the chat with language models, one per medium, and diagrams (organization charts, flowcharts, schemas). */
export type StudioMode = 'chat' | 'image' | 'audio' | 'video' | 'diagram'

export const STUDIO_MODES: readonly StudioMode[] = ['chat', 'image', 'audio', 'video', 'diagram']

/** Cover of a conversation (subset of the engine's asset). */
export interface ConversationCover {
  id: string
  thumb_url: string
}

/** Conversation as listed in the sidebar (same shape as the engine / future Nest API: `updated_at` in epoch seconds). */
export interface ConversationSummary {
  id: string
  mode: StudioMode
  title: string
  pinned: boolean
  created_at: number
  updated_at: number
  cover: ConversationCover | null
  generation_count: number
  busy: boolean
}

/** A conversation with its messages; the messages are typed by the modules that render them (`studio-core`: `Message`). */
export interface Conversation<TMessage = unknown> extends ConversationSummary {
  messages: TMessage[]
}

export interface ConversationPatch {
  title?: string
  pinned?: boolean
}
