/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ChatMessage } from '../types'

export interface BranchPosition {
  /** 1-based position among the siblings, and how many there are. */
  index: number
  total: number
  previousId: string | null
  nextId: string | null
}

/** Where a message sits among its siblings (the `‹ 2/3 ›` navigator); `null` when it has none. */
export function branchPosition(message: Pick<ChatMessage, 'sibling_ids' | 'sibling_index'>): BranchPosition | null {
  const ids = message.sibling_ids
  if (ids.length < 2) return null
  const at = Math.min(Math.max(message.sibling_index, 0), ids.length - 1)
  return { index: at + 1, total: ids.length, previousId: at > 0 ? ids[at - 1] : null, nextId: at < ids.length - 1 ? ids[at + 1] : null }
}

/**
 * The answers to compare with `message`: its siblings (other answers to the same question) that this browser has seen,
 * oldest first, itself included, when at least two of them come from different models.
 */
export function comparisonSet(message: ChatMessage, seen: ReadonlyMap<string, ChatMessage>): ChatMessage[] | null {
  if (message.role !== 'assistant' || message.sibling_ids.length < 2) return null
  const group = message.sibling_ids.map((id) => (id === message.id ? message : seen.get(id))).filter((m): m is ChatMessage => !!m && m.status !== 'streaming')
  const models = new Set(group.map((m) => m.model_id ?? ''))
  return group.length >= 2 && models.size >= 2 ? group : null
}

/** Whether some sibling of an answer was never seen by this browser (after a reload the server sends the active branch only). */
export function missingSiblings(message: Pick<ChatMessage, 'id' | 'role' | 'status' | 'sibling_ids'>, seen: ReadonlyMap<string, unknown>): boolean {
  return message.role === 'assistant' && message.status !== 'streaming' && message.sibling_ids.some((id) => id !== message.id && !seen.has(id))
}

/** The leaf of the branch the interface should show after the active path changed, or `null` to keep the server's. */
export function lastMessageId(messages: readonly ChatMessage[]): string | null {
  return messages.length > 0 ? messages[messages.length - 1].id : null
}
