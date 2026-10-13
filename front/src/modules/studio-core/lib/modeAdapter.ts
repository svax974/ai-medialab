/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ComponentType } from 'react'
import type { StudioMode } from '@/modules/studio-shell/types'
import type { Message } from '../types'

/**
 * What a creation mode plugs into the conversation thread: its composer, how its generations are drawn and how a prompt
 * goes back to the composer. The thread (title, scrolling, user messages, empty state) is common to the three modes.
 * Image: `image-studio`; audio: `audio-studio`; video: `video-studio`.
 */
export interface ModeAdapter {
  kind: StudioMode
  Composer: ComponentType<{ conversationId: string }>
  AssistantMessage: ComponentType<{ message: Message; siblings: readonly Message[] }>
  reuseUserMessage: (message: Message) => void
}

export type ModeAdapters = Partial<Record<StudioMode, ModeAdapter>>
