/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import type { StudioEventLike } from '@/modules/studio-core/lib/studioEvents'

const PREFIX = 'studio.'
const nameOf = (topic: string): string => (topic.startsWith(PREFIX) ? topic.slice(PREFIX.length) : topic)
import type { ChatMessage } from '../types'

/** Ids of the studio messages that run the generations of these chat messages. */
export function generationMessageIds(messages: readonly Pick<ChatMessage, 'generations'>[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const message of messages) for (const generation of message.generations ?? []) if (generation.message_id) ids.add(generation.message_id)
  return ids
}

/** Whether a `studio.*` event is about one of these jobs: a state change, a produced file, or a deletion of the message. */
export function concernsGeneration(event: StudioEventLike, ids: ReadonlySet<string>): boolean {
  const data = event.data ?? {}
  const name = nameOf(event.topic)
  if (name === 'message.updated') return typeof data['id'] === 'string' && ids.has(data['id'])
  if (name === 'job.image') return typeof data['message_id'] === 'string' && ids.has(data['message_id'])
  if (name === 'message.deleted') return Array.isArray(data['ids']) && data['ids'].some((id) => typeof id === 'string' && ids.has(id))
  return false
}
