/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { effectOfEvent, effectOfResync } from './eventEffects'

describe('effectOfEvent', () => {
  it('conversation.updated refreshes the lists and that conversation', () => {
    const effect = effectOfEvent({ topic: 'engine.conversation.updated', data: { id: 'c1' } })
    expect(effect.invalidate).toEqual([['conversations'], ['conversation', 'c1']])
    expect(effect.remove).toEqual([])
  })

  it('conversation.updated without id only refreshes the lists', () => {
    expect(effectOfEvent({ topic: 'engine.conversation.updated' }).invalidate).toEqual([['conversations']])
  })

  it('conversation.deleted removes the cached conversation', () => {
    const effect = effectOfEvent({ topic: 'engine.conversation.deleted', data: { id: 'c1' } })
    expect(effect.remove).toEqual([['conversation', 'c1']])
    expect(effect.invalidate).toEqual([['conversations']])
  })

  it('message.updated refreshes the lists only once the message is finished', () => {
    expect(effectOfEvent({ topic: 'engine.message.updated', data: { conversation_id: 'c1', status: 'running' } }).invalidate).toEqual([
      ['conversation', 'c1'],
    ])
    expect(effectOfEvent({ topic: 'engine.message.updated', data: { conversation_id: 'c1', status: 'done' } }).invalidate).toEqual([
      ['conversations'],
      ['conversation', 'c1'],
    ])
  })

  it('message.deleted refreshes the conversation', () => {
    expect(effectOfEvent({ topic: 'engine.message.deleted', data: { conversation_id: 'c2', ids: ['m'] } }).invalidate).toEqual([['conversation', 'c2']])
  })

  it('engine.link refreshes everything only when it reconnects', () => {
    expect(effectOfEvent({ topic: 'engine.link', data: { connected: true } })).toEqual(effectOfResync())
    expect(effectOfEvent({ topic: 'engine.link', data: { connected: false } }).invalidate).toEqual([])
  })

  it('engine status refreshes the worker state; models and finished installs refresh the machine', () => {
    expect(effectOfEvent({ topic: 'engine.engine.status', data: { state: 'idle' } }).invalidate).toEqual([['engine-status']])
    expect(effectOfEvent({ topic: 'engine.models.changed' }).invalidate).toEqual([['models'], ['system']])
    expect(effectOfEvent({ topic: 'engine.engine.install', data: { state: 'done' } }).invalidate).toEqual([['models'], ['system']])
    expect(effectOfEvent({ topic: 'engine.pack.install', data: { state: 'error' } }).invalidate).toEqual([['models'], ['system']])
  })

  it('a finished download refreshes the catalogue and the free disk; a running one changes nothing', () => {
    for (const state of ['done', 'error', 'cancelled']) {
      expect(effectOfEvent({ topic: 'engine.download.progress', data: { model_id: 'm', state } }).invalidate).toEqual([['models'], ['system']])
    }
    expect(effectOfEvent({ topic: 'engine.download.progress', data: { model_id: 'm', state: 'running' } })).toEqual({ invalidate: [], remove: [] })
  })

  it('a running install (many progress events) changes nothing', () => {
    expect(effectOfEvent({ topic: 'engine.engine.install', data: { state: 'running' } })).toEqual({ invalidate: [], remove: [] })
    expect(effectOfEvent({ topic: 'engine.pack.install', data: { state: 'running' } })).toEqual({ invalidate: [], remove: [] })
  })

  it('ignores other topics', () => {
    expect(effectOfEvent({ topic: 'engine.job.progress' })).toEqual({ invalidate: [], remove: [] })
  })
})
