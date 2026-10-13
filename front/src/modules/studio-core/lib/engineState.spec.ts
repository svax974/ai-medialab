/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { EngineStatus } from '@/modules/hardware'
import { engineCardView } from './engineState'

const status = (extra: Partial<EngineStatus> = {}): EngineStatus => ({ state: 'idle', model_id: null, quantize: null, load_started_at: null, current_message_id: null, queue: [], last_error: null, ...extra })

describe('engineCardView', () => {
  it('shows nothing loaded, loaded on demand', () => {
    expect(engineCardView(status(), null, null)).toMatchObject({ tone: 'idle', pulse: false, labelKey: 'thread.engine.none', detail: { key: 'thread.engine.onDemand' }, canUnload: false })
  })

  it('shows the loading with the clock start', () => {
    expect(engineCardView(status({ state: 'loading', load_started_at: 100 }), null, null)).toMatchObject({ tone: 'warn', pulse: true, labelKey: 'thread.engine.loading', detail: { clockFrom: 100 }, canUnload: false })
    expect(engineCardView(status({ state: 'loading' }), null, null).detail).toBeNull()
  })

  it('shows the model that generates, with a video wording for video models', () => {
    expect(engineCardView(status({ state: 'busy', model_id: 'flux' }), 'Flux', 'image')).toMatchObject({ tone: 'safe', pulse: true, name: 'Flux', labelKey: null, detail: { key: 'thread.engine.inProgress' }, canUnload: false })
    expect(engineCardView(status({ state: 'busy' }), 'Wan', 'video').detail).toEqual({ key: 'thread.engine.renderingVideo' })
    expect(engineCardView(status({ state: 'busy' }), null, null)).toMatchObject({ labelKey: 'thread.engine.generating', name: null })
  })

  it('shows the loaded model with its quantization and allows unloading', () => {
    expect(engineCardView(status({ state: 'ready', model_id: 'flux', quantize: 4 }), 'Flux', 'image')).toMatchObject({ tone: 'ok', name: 'Flux', detail: { key: 'thread.engine.inMemoryBits', params: [4] }, canUnload: true })
    expect(engineCardView(status({ state: 'ready', model_id: 'flux' }), null, null)).toMatchObject({ name: 'flux', detail: { key: 'thread.engine.inMemory' } })
    expect(engineCardView(status({ state: 'ready' }), null, null)).toMatchObject({ name: null, labelKey: 'thread.engine.ready' })
  })

  it('counts the waiting messages of every conversation', () => {
    expect(engineCardView(status(), null, null, ['a', 'b', 'c']).queued).toBe(3)
    expect(engineCardView(status(), null, null).queued).toBe(0)
  })

  it('adds the jobs only the engine lists (the former interface), once when in both', () => {
    expect(engineCardView(status({ queue: ['a', 'x'] }), null, null, ['a', 'b']).queued).toBe(3)
  })
})
