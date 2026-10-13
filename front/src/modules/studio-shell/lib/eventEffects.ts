/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioKeys } from './queryKeys'

/** Subscribed topics: the engine events relayed by Nest as `engine.<name>` (back/src/modules/engine/README.md). */
export const ENGINE_TOPICS = [
  'engine.conversation.updated',
  'engine.conversation.deleted',
  'engine.message.updated',
  'engine.message.deleted',
  'engine.link',
] as const

export interface EventLike {
  topic: string
  data?: Record<string, unknown>
}

/** What to do in the query cache for an event: queries to invalidate and to remove. */
export interface CacheEffect {
  invalidate: (readonly unknown[])[]
  remove: (readonly unknown[])[]
}

const NONE: CacheEffect = { invalidate: [], remove: [] }
const FINISHED_STATUSES = ['done', 'error']

const stringOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Maps an engine event to cache invalidations (the stream carries invalidations, the client re-reads by REST).
 * `engine.link` reconnecting re-reads everything: events may have been missed while the link was down.
 */
export function effectOfEvent(event: EventLike): CacheEffect {
  const data = event.data ?? {}
  switch (event.topic) {
    case 'engine.conversation.updated': {
      const id = stringOf(data['id'])
      return { invalidate: [studioKeys.conversations, ...(id ? [studioKeys.conversation(id)] : [])], remove: [] }
    }
    case 'engine.conversation.deleted': {
      const id = stringOf(data['id'])
      return { invalidate: [studioKeys.conversations], remove: id ? [studioKeys.conversation(id)] : [] }
    }
    case 'engine.message.updated': {
      const conversationId = stringOf(data['conversation_id'])
      const finished = FINISHED_STATUSES.includes(String(data['status']))
      return {
        invalidate: [...(finished ? [studioKeys.conversations] : []), ...(conversationId ? [studioKeys.conversation(conversationId)] : [])],
        remove: [],
      }
    }
    case 'engine.message.deleted': {
      const conversationId = stringOf(data['conversation_id'])
      return conversationId ? { invalidate: [studioKeys.conversation(conversationId)], remove: [] } : NONE
    }
    case 'engine.link':
      return data['connected'] === true ? effectOfResync() : NONE
    default:
      return NONE
  }
}

/** Server asked to reload everything (replay impossible after a reconnection). */
export function effectOfResync(): CacheEffect {
  return { invalidate: [studioKeys.conversations, studioKeys.conversationAll], remove: [] }
}
