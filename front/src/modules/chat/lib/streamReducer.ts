/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ChatConversation, ChatMessage, ChatStreamEvent, ToolRun } from '../types'

function patchMessage(conversation: ChatConversation, id: string, patch: (message: ChatMessage) => ChatMessage): ChatConversation {
  if (!conversation.messages.some((m) => m.id === id)) return conversation
  return { ...conversation, messages: conversation.messages.map((m) => (m.id === id ? patch(m) : m)) }
}

function withRun(runs: ToolRun[], run: ToolRun): ToolRun[] {
  return runs.some((r) => r.id === run.id) ? runs.map((r) => (r.id === run.id ? run : r)) : [...runs, run]
}

/**
 * A message the server created: it replaces the one with its id, else it takes the end of the active branch, right after
 * its parent (an edit or a regeneration starts a new branch: what followed the old sibling leaves the thread).
 */
export function placeMessage(conversation: ChatConversation, message: ChatMessage): ChatConversation {
  const known = conversation.messages.findIndex((m) => m.id === message.id)
  if (known !== -1) return { ...conversation, messages: conversation.messages.map((m, i) => (i === known ? message : m)) }
  const parent = message.parent_id === null ? -1 : conversation.messages.findIndex((m) => m.id === message.parent_id)
  if (message.parent_id !== null && parent === -1) return { ...conversation, messages: [...conversation.messages, message] }
  const kept = conversation.messages.slice(0, parent + 1)
  return {
    ...conversation,
    messages: [...kept, message],
    settings: { ...conversation.settings, leaf_id: message.id },
    conversation: { ...conversation.conversation, generation_count: kept.length + 1 },
  }
}

/** Applies one stream event to the conversation held in the cache (pure: returns the same object when nothing changes). */
export function applyStreamEvent(conversation: ChatConversation, event: ChatStreamEvent): ChatConversation {
  switch (event.type) {
    case 'message':
      return placeMessage(conversation, event.message)
    case 'done':
      return placeMessage(conversation, event.message)
    case 'delta':
      return patchMessage(conversation, event.id, (m) => ({ ...m, content: m.content + event.content }))
    case 'reasoning':
      return patchMessage(conversation, event.id, (m) => ({ ...m, reasoning: (m.reasoning ?? '') + event.content }))
    case 'tool':
      return patchMessage(conversation, event.id, (m) => ({ ...m, tool_runs: withRun(m.tool_runs, event.run) }))
    case 'usage':
      return patchMessage(conversation, event.id, (m) => ({ ...m, stats: event.stats }))
    case 'title':
      return { ...conversation, conversation: { ...conversation.conversation, title: event.title } }
    case 'error':
      return event.id ? patchMessage(conversation, event.id, (m) => ({ ...m, status: 'error', error: event.message })) : conversation
    default:
      return conversation
  }
}

/** Whether an answer of the thread is still being written. */
export const isStreaming = (conversation: ChatConversation): boolean => conversation.messages.some((m) => m.status === 'streaming')

/** Whether the server's copy has an answer not settled yet (`streaming`): to be read again when this browser is not reading it. */
export const needsSettling = isStreaming
