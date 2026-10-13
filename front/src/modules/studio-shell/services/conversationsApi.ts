/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Conversation, ConversationPatch, ConversationSummary, StudioMode } from '../types'
import { studioRequest } from './studioHttp'

/** Conversations of the engine through the transitional proxy (`/api/conversations`). */
export const conversationsApi = {
  list(query: string, mode: StudioMode): Promise<ConversationSummary[]> {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    params.set('mode', mode)
    return studioRequest<ConversationSummary[]>('get', `/conversations?${params.toString()}`)
  },
  get(id: string): Promise<Conversation> {
    return studioRequest<Conversation>('get', `/conversations/${encodeURIComponent(id)}`)
  },
  patch(id: string, patch: ConversationPatch): Promise<ConversationSummary> {
    return studioRequest<ConversationSummary>('patch', `/conversations/${encodeURIComponent(id)}`, patch)
  },
  remove(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/conversations/${encodeURIComponent(id)}`)
  },
}
