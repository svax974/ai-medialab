/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Creation mode of the studio: one per medium. */
export type StudioMode = 'image' | 'audio' | 'video'

export const STUDIO_MODES: readonly StudioMode[] = ['image', 'audio', 'video']

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

/** A conversation with its messages; the messages are typed by the modules that render them (H4). */
export interface Conversation extends ConversationSummary {
  messages: unknown[]
}

export interface ConversationPatch {
  title?: string
  pinned?: boolean
}
