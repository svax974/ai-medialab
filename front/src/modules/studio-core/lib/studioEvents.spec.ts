/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset, ConversationDetail, Message } from '../types'
import {
  STUDIO_TOPICS, addOutput, mergeSummary, opsOfStudioEvent, patchAssetInConversation, patchAssetInPage, removeMessages, upsertMessage, type StudioOp,
} from './studioEvents'

const asset = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'generated', media: 'image', url: `/media/outputs/${id}.png`, thumb_url: '', width: 8, height: 8, seed: 1, original_name: null, favorite: false, meta: {}, conversation_id: 'c1', message_id: 'a1', created_at: 5, ...extra }) as Asset

const message = (id: string, extra: Partial<Message> = {}): Message =>
  ({ id, conversation_id: 'c1', parent_id: null, role: 'assistant', prompt: '', model_id: 'm', params: {}, status: 'running', error: null, created_at: 10, started_at: null, finished_at: null, references: [], outputs: [], ...extra }) as Message

const conversation = (messages: Message[] = []): ConversationDetail =>
  ({ id: 'c1', mode: 'image', title: 'T', pinned: false, created_at: 1, updated_at: 2, cover: null, generation_count: 0, busy: false, messages }) as ConversationDetail

/** Applies the operations that target a conversation to a starting state, the way the hook does. */
const run = (ops: StudioOp[], start: ConversationDetail) =>
  ops.reduce((state, op) => (op.type === 'conversation' && op.id === state.id ? op.update(state) : state), start)

describe('upsertMessage', () => {
  it('replaces a known message', () => {
    const next = upsertMessage(conversation([message('a1', { status: 'queued' })]), message('a1', { status: 'done' }))
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].status).toBe('done')
  })

  it('inserts a new message in chronological order, ties broken by id', () => {
    const start = conversation([message('b', { created_at: 20 }), message('a', { created_at: 10 })])
    expect(upsertMessage(start, message('c', { created_at: 15 })).messages.map((m) => m.id)).toEqual(['a', 'c', 'b'])
    expect(upsertMessage(conversation([message('z', { created_at: 5 })]), message('y', { created_at: 5 })).messages.map((m) => m.id)).toEqual(['y', 'z'])
  })
})

describe('addOutput / removeMessages / mergeSummary', () => {
  it('adds an image once and ignores a duplicate', () => {
    const once = addOutput(conversation([message('a1')]), 'a1', asset('i1'))
    expect(addOutput(once, 'a1', asset('i1')).messages[0].outputs).toHaveLength(1)
    expect(addOutput(once, 'a1', asset('i2', { created_at: 4 })).messages[0].outputs.map((o) => o.id)).toEqual(['i2', 'i1'])
  })

  it('does not touch other messages', () => {
    const next = addOutput(conversation([message('a1'), message('a2')]), 'a1', asset('i1'))
    expect(next.messages[1].outputs).toEqual([])
  })

  it('removes the listed messages', () => {
    expect(removeMessages(conversation([message('u'), message('a1'), message('a2')]), ['u', 'a1']).messages.map((m) => m.id)).toEqual(['a2'])
  })

  it('keeps the messages when a summary arrives', () => {
    const merged = mergeSummary(conversation([message('a1')]), { id: 'c1', mode: 'image', title: 'New', pinned: true, created_at: 1, updated_at: 9, cover: null, generation_count: 1, busy: true })
    expect(merged).toMatchObject({ title: 'New', pinned: true, busy: true })
    expect(merged.messages).toHaveLength(1)
  })
})

describe('asset patches', () => {
  it('patches an asset in references and outputs', () => {
    const start = conversation([message('u', { references: [asset('r1')] }), message('a1', { outputs: [asset('i1')] })])
    const next = patchAssetInConversation(patchAssetInConversation(start, asset('i1', { favorite: true })), asset('r1', { favorite: true }))
    expect(next.messages[1].outputs[0].favorite).toBe(true)
    expect(next.messages[0].references[0].favorite).toBe(true)
  })

  it('patches a page of the gallery', () => {
    expect(patchAssetInPage({ items: [asset('i1'), asset('i2')], next_before: null }, asset('i2', { favorite: true })).items.map((a) => a.favorite)).toEqual([false, true])
  })
})

describe('opsOfStudioEvent', () => {
  it('subscribes to the eight studio topics', () => {
    expect(STUDIO_TOPICS).toHaveLength(8)
    expect(STUDIO_TOPICS.every((topic) => topic.startsWith('studio.'))).toBe(true)
  })

  it('forwards the progress of a job', () => {
    expect(opsOfStudioEvent({ topic: 'studio.job.progress', data: { message_id: 'a1', step: 3 } })).toEqual([{ type: 'progress', progress: { message_id: 'a1', step: 3 } }])
    expect(opsOfStudioEvent({ topic: 'studio.job.progress', data: {} })).toEqual([])
  })

  it('upserts a running message and keeps its progress', () => {
    const ops = opsOfStudioEvent({ topic: 'studio.message.updated', data: message('a1', { status: 'running' }) as unknown as Record<string, unknown> })
    expect(ops.map((op) => op.type)).toEqual(['conversation'])
    expect(run(ops, conversation()).messages.map((m) => m.id)).toEqual(['a1'])
  })

  it('clears the progress and refreshes the lists once a message is no longer busy', () => {
    for (const status of ['done', 'error', 'cancelled']) {
      const ops = opsOfStudioEvent({ topic: 'studio.message.updated', data: message('a1', { status: status as Message['status'] }) as unknown as Record<string, unknown> })
      expect(ops.map((op) => op.type)).toEqual(['conversation', 'clearProgress', 'invalidate'])
    }
  })

  it('adds the image of job.image and refreshes the assets', () => {
    const ops = opsOfStudioEvent({ topic: 'studio.job.image', data: { message_id: 'a1', conversation_id: 'c1', asset: asset('i1') } })
    expect(run(ops, conversation([message('a1')])).messages[0].outputs.map((o) => o.id)).toEqual(['i1'])
    expect(ops).toContainEqual({ type: 'invalidate', key: ['assets'] })
  })

  it('removes deleted messages', () => {
    const ops = opsOfStudioEvent({ topic: 'studio.message.deleted', data: { conversation_id: 'c1', ids: ['a1'] } })
    expect(run(ops, conversation([message('a1'), message('a2')])).messages.map((m) => m.id)).toEqual(['a2'])
  })

  it('merges a conversation summary and refreshes the lists', () => {
    const ops = opsOfStudioEvent({ topic: 'studio.conversation.updated', data: { id: 'c1', title: 'Renamed', pinned: false, mode: 'image' } })
    expect(run(ops, conversation([message('a1')])).title).toBe('Renamed')
    expect(ops).toContainEqual({ type: 'invalidate', key: ['conversations'] })
  })

  it('drops a deleted conversation from the cache', () => {
    expect(opsOfStudioEvent({ topic: 'studio.conversation.deleted', data: { id: 'c1' } })).toEqual([
      { type: 'remove', key: ['conversation', 'c1'] },
      { type: 'invalidate', key: ['conversations'] },
      { type: 'invalidate', key: ['assets'] },
    ])
  })

  it('patches an updated asset and re-reads the conversation of a deleted one', () => {
    expect(opsOfStudioEvent({ topic: 'studio.asset.updated', data: asset('i1') as unknown as Record<string, unknown> })).toEqual([{ type: 'asset', asset: asset('i1') }])
    expect(opsOfStudioEvent({ topic: 'studio.asset.deleted', data: { id: 'i1', message_id: 'a1', conversation_id: 'c1' } })).toEqual([
      { type: 'invalidate', key: ['conversation', 'c1'] },
      { type: 'invalidate', key: ['assets'] },
    ])
    expect(opsOfStudioEvent({ topic: 'studio.asset.deleted', data: { id: 'i1', conversation_id: null } })).toEqual([{ type: 'invalidate', key: ['assets'] }])
  })

  it('ignores malformed and unknown events', () => {
    expect(opsOfStudioEvent({ topic: 'studio.message.updated', data: { id: 'x' } })).toEqual([])
    expect(opsOfStudioEvent({ topic: 'studio.job.image', data: { message_id: 'a1' } })).toEqual([])
    expect(opsOfStudioEvent({ topic: 'studio.unknown' })).toEqual([])
    expect(opsOfStudioEvent({ topic: 'engine.models.changed' })).toEqual([])
  })
})
