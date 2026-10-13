/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { useImageDraftStore } from './imageDraftStore'
import { useLiveStore } from './liveStore'
import { useQueueStore } from './queueStore'

const asset = (id: string, favorite = false) => ({ id, favorite }) as Asset

describe('liveStore', () => {
  beforeEach(() => useLiveStore.getState().clear())

  it('merges the events of a message and clears it at the end', () => {
    const { setProgress, clearProgress } = useLiveStore.getState()
    setProgress({ message_id: 'a', phase: 'running', step: 1, total: 8 })
    setProgress({ message_id: 'a', preview_url: '/media/previews/p.webp' })
    setProgress({ message_id: 'a', step: 2 })
    expect(useLiveStore.getState().progress['a']).toEqual({ message_id: 'a', phase: 'running', step: 2, total: 8, preview_url: '/media/previews/p.webp' })
    clearProgress('a')
    expect(useLiveStore.getState().progress).toEqual({})
  })

  it('keeps the same state when clearing an unknown message', () => {
    const before = useLiveStore.getState().progress
    useLiveStore.getState().clearProgress('zz')
    expect(useLiveStore.getState().progress).toBe(before)
  })
})

describe('imageDraftStore', () => {
  beforeEach(() => useImageDraftStore.setState({ prompt: '', references: [], uploading: [], paramsByModel: {}, count: 1, seed: null }))

  it('adds references once, in order, and removes them', () => {
    const { addReferences, removeReference, clearReferences } = useImageDraftStore.getState()
    addReferences([asset('a'), asset('b')])
    addReferences([asset('b'), asset('c')])
    expect(useImageDraftStore.getState().references.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    removeReference('b')
    expect(useImageDraftStore.getState().references.map((r) => r.id)).toEqual(['a', 'c'])
    clearReferences()
    expect(useImageDraftStore.getState().references).toEqual([])
  })

  it('merges the parameters of a model and resets only that model', () => {
    const { setParams, resetParams } = useImageDraftStore.getState()
    setParams('flux', { steps: 4 })
    setParams('flux', { aspect: '16:9' })
    setParams('sdxl', { steps: 30 })
    expect(useImageDraftStore.getState().paramsByModel['flux']).toEqual({ steps: 4, aspect: '16:9' })
    resetParams('flux')
    expect(Object.keys(useImageDraftStore.getState().paramsByModel)).toEqual(['sdxl'])
  })
})

describe('queueStore', () => {
  beforeEach(() => useQueueStore.setState({ current: null, queue: [], loaded: false }))

  it('is unknown until the first state, then follows the queue', () => {
    expect(useQueueStore.getState().loaded).toBe(false)
    useQueueStore.getState().set({ current: 'a', queue: ['b', 'c'] })
    expect(useQueueStore.getState()).toMatchObject({ loaded: true, current: 'a', queue: ['b', 'c'] })
    useQueueStore.getState().set({ current: null, queue: [] })
    expect(useQueueStore.getState().queue).toEqual([])
  })
})
