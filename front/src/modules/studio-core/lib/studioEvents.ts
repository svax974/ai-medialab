/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ConversationSummary } from '@/modules/studio-shell/types'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import type { Asset, ConversationDetail, JobProgress, Message, QueueState } from '../types'
import { isActive } from './messageState'
import { assetKeys } from '@/modules/media-library/lib/assetKeys'

/**
 * Topics published by Nest (`studio.<name>`, same names and shapes as the former SSE of the engine;
 * back/src/modules/studio-core/README.md). Subscribed once by `useStudioEvents`.
 */
export const STUDIO_TOPICS = [
  'studio.job.progress',
  'studio.job.image',
  'studio.message.updated',
  'studio.message.deleted',
  'studio.conversation.updated',
  'studio.conversation.deleted',
  'studio.asset.updated',
  'studio.asset.deleted',
  'studio.queue.updated',
] as const

export interface StudioEventLike {
  topic: string
  data?: Record<string, unknown>
}

/** What an event does to the client state. The hook applies the operations; they are plain data, so they are testable. */
export type StudioOp =
  /** Rewrites a cached conversation (nothing happens when it is not cached). */
  | { type: 'conversation'; id: string; update: (conversation: ConversationDetail) => ConversationDetail }
  | { type: 'progress'; progress: JobProgress }
  | { type: 'clearProgress'; messageId: string }
  | { type: 'asset'; asset: Asset }
  /** An asset was deleted: it leaves the lists and the viewer. */
  | { type: 'assetDeleted'; id: string }
  | { type: 'queue'; state: QueueState }
  | { type: 'invalidate'; key: readonly unknown[] }
  | { type: 'remove'; key: readonly unknown[] }

// --- Pure cache updates -------------------------------------------------------------------------------------------

const byAge = (a: Message, b: Message) => a.created_at - b.created_at || a.id.localeCompare(b.id)

/** Inserts or replaces a message, keeping the conversation ordered from the oldest to the newest. */
export function upsertMessage(conversation: ConversationDetail, message: Message): ConversationDetail {
  const exists = conversation.messages.some((m) => m.id === message.id)
  const messages = exists ? conversation.messages.map((m) => (m.id === message.id ? message : m)) : [...conversation.messages, message].sort(byAge)
  return { ...conversation, messages }
}

/** Adds a produced image to its message (nothing when already there), in the order of production. */
export function addOutput(conversation: ConversationDetail, messageId: string, asset: Asset): ConversationDetail {
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.id === messageId && !m.outputs.some((o) => o.id === asset.id) ? { ...m, outputs: [...m.outputs, asset].sort((a, b) => a.created_at - b.created_at) } : m,
    ),
  }
}

export function removeMessages(conversation: ConversationDetail, ids: readonly string[]): ConversationDetail {
  return { ...conversation, messages: conversation.messages.filter((m) => !ids.includes(m.id)) }
}

/** New summary (title, pin, cover, count, busy) over the cached conversation; the messages are kept. */
export function mergeSummary(conversation: ConversationDetail, summary: ConversationSummary): ConversationDetail {
  return { ...conversation, ...summary, messages: conversation.messages }
}

/** Replaces an asset wherever a conversation shows it (references and outputs). */
export function patchAssetInConversation(conversation: ConversationDetail, asset: Asset): ConversationDetail {
  const patch = (a: Asset) => (a.id === asset.id ? { ...a, ...asset } : a)
  return { ...conversation, messages: conversation.messages.map((m) => ({ ...m, references: m.references.map(patch), outputs: m.outputs.map(patch) })) }
}


// --- Events to operations -----------------------------------------------------------------------------------------

const isString = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isMessage = (data: Record<string, unknown>): data is Record<string, unknown> & Message => isString(data['id']) && isString(data['conversation_id'])
const isAsset = (value: unknown): value is Asset => typeof value === 'object' && value !== null && isString((value as { id?: unknown }).id)

const lists: StudioOp = { type: 'invalidate', key: studioKeys.conversations }
const assets: StudioOp = { type: 'invalidate', key: assetKeys.all }

/** Operations for one `studio.*` event. Unknown or malformed events do nothing. */
export function opsOfStudioEvent(event: StudioEventLike): StudioOp[] {
  const data = event.data ?? {}
  switch (event.topic) {
    case 'studio.job.progress':
      return isString(data['message_id']) ? [{ type: 'progress', progress: data as unknown as JobProgress }] : []
    case 'studio.message.updated': {
      if (!isMessage(data)) return []
      const message: Message = data
      return [
        { type: 'conversation', id: message.conversation_id, update: (c) => upsertMessage(c, message) },
        ...(isActive(message.status) ? [] : [{ type: 'clearProgress', messageId: message.id } as const, lists]),
      ]
    }
    case 'studio.job.image': {
      const messageId = data['message_id']
      const conversationId = data['conversation_id']
      const asset = data['asset']
      if (!isString(messageId) || !isString(conversationId) || !isAsset(asset)) return []
      return [{ type: 'conversation', id: conversationId, update: (c) => addOutput(c, messageId, asset) }, assets]
    }
    case 'studio.message.deleted': {
      const conversationId = data['conversation_id']
      const ids = data['ids']
      if (!isString(conversationId) || !Array.isArray(ids)) return []
      return [{ type: 'conversation', id: conversationId, update: (c) => removeMessages(c, ids as string[]) }]
    }
    case 'studio.conversation.updated': {
      if (!isString(data['id'])) return []
      const summary = data as unknown as ConversationSummary
      return [{ type: 'conversation', id: summary.id, update: (c) => mergeSummary(c, summary) }, lists]
    }
    case 'studio.conversation.deleted':
      return isString(data['id']) ? [{ type: 'remove', key: studioKeys.conversation(data['id']) }, lists, assets] : []
    case 'studio.asset.updated':
      return isAsset(data) ? [{ type: 'asset', asset: data }] : []
    case 'studio.asset.deleted':
      return [
        ...(isString(data['id']) ? [{ type: 'assetDeleted', id: data['id'] } as const] : []),
        ...(isString(data['conversation_id']) ? [{ type: 'invalidate', key: studioKeys.conversation(data['conversation_id']) } as const] : []),
        assets,
      ]
    case 'studio.queue.updated':
      return Array.isArray(data['queue']) ? [{ type: 'queue', state: { current: isString(data['current']) ? data['current'] : null, queue: (data['queue'] as unknown[]).filter(isString) } }] : []
    default:
      return []
  }
}
