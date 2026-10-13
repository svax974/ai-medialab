/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { StudioMode } from '../types'

/** TanStack Query keys of the studio shell; the prefix of each family is what event invalidations target. */
export const studioKeys = {
  conversations: ['conversations'] as const,
  conversationList: (mode: StudioMode, query: string) => ['conversations', mode, query] as const,
  conversation: (id: string) => ['conversation', id] as const,
  conversationAll: ['conversation'] as const,
}
