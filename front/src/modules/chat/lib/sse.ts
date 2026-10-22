/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ChatErrorCode, ChatMessage, ChatStats, ChatStreamEvent, ToolRun } from '../types'

/** A block of the stream as the template's `SseParser` dispatches it (`readSse`, `core/events`). */
export interface SseBlock {
  event: string
  data: string
}

const EVENT_TYPES = new Set(['message', 'loading', 'delta', 'reasoning', 'tool', 'usage', 'title', 'done', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns a block into a typed event: the event name is the type, the JSON `data` the rest. An unknown type, malformed
 * JSON or a payload that lacks what its type needs yields `null` (the stream goes on: a bad block never stops the answer).
 * This is the boundary of untrusted JSON: only the members each type needs are checked.
 */
export function toChatEvent(block: SseBlock): ChatStreamEvent | null {
  if (!EVENT_TYPES.has(block.event)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(block.data)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const p = parsed
  const text = (key: string): string | null => (typeof p[key] === 'string' ? (p[key] as string) : null)
  const object = <T,>(key: string): T | null => (isRecord(p[key]) ? (p[key] as unknown as T) : null)
  const id = text('id')
  switch (block.event) {
    case 'message':
    case 'done': {
      const message = object<ChatMessage>('message')
      return message ? { type: block.event, message } : null
    }
    case 'delta':
    case 'reasoning': {
      const content = text('content')
      return id !== null && content !== null ? { type: block.event, id, content } : null
    }
    case 'tool': {
      const run = object<ToolRun>('run')
      return id !== null && run ? { type: 'tool', id, run } : null
    }
    case 'usage': {
      const stats = object<ChatStats>('stats')
      return id !== null && stats ? { type: 'usage', id, stats } : null
    }
    case 'title': {
      const title = text('title')
      return title !== null ? { type: 'title', title } : null
    }
    case 'loading': {
      const phase = text('phase')
      if (phase !== 'starting' && phase !== 'loading' && phase !== 'ready') return null
      return { type: 'loading', phase, model_id: text('model_id') ?? '', elapsed_s: typeof p['elapsed_s'] === 'number' ? p['elapsed_s'] : undefined }
    }
    default: {
      const message = text('message')
      return message !== null ? { type: 'error', code: (text('code') ?? 'upstream') as ChatErrorCode, message, id: id ?? undefined } : null
    }
  }
}
