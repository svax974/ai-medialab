/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ConversationDetail } from '@/modules/studio-core/types'
import type { ConversationPatch, ConversationSummary, StudioMode } from '../types'
import { studioRequest } from './studioHttp'

/** Conversations (`/api/conversations`, Nest module `studio-core`). */
export const conversationsApi = {
  list(query: string, mode: StudioMode): Promise<ConversationSummary[]> {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    params.set('mode', mode)
    return studioRequest<ConversationSummary[]>('get', `/conversations?${params.toString()}`)
  },
  get(id: string): Promise<ConversationDetail> {
    return studioRequest<ConversationDetail>('get', `/conversations/${encodeURIComponent(id)}`)
  },
  patch(id: string, patch: ConversationPatch): Promise<ConversationSummary> {
    return studioRequest<ConversationSummary>('patch', `/conversations/${encodeURIComponent(id)}`, patch)
  },
  remove(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/conversations/${encodeURIComponent(id)}`)
  },
}
