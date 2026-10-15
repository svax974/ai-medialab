/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { ENGINE_TOPICS, effectOfEvent, effectOfResync } from './eventEffects'

describe('effectOfEvent', () => {
  it('no longer handles the conversation and message events of the engine (studio.* topics)', () => {
    expect(ENGINE_TOPICS.some((topic) => topic.startsWith('engine.conversation') || topic.startsWith('engine.message'))).toBe(false)
    expect(effectOfEvent({ topic: 'engine.conversation.updated', data: { id: 'c1' } })).toEqual({ invalidate: [], remove: [] })
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
    expect(effectOfEvent({ topic: 'engine.llamacpp.install', data: { state: 'done' } }).invalidate).toEqual([['models'], ['system']])
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
    expect(effectOfEvent({ topic: 'engine.llamacpp.install', data: { state: 'running' } })).toEqual({ invalidate: [], remove: [] })
  })

  it('ignores other topics', () => {
    expect(effectOfEvent({ topic: 'engine.job.progress' })).toEqual({ invalidate: [], remove: [] })
  })
})
