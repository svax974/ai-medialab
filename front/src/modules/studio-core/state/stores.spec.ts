/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { useImageDraftStore } from './imageDraftStore'
import { useLightboxStore } from './lightboxStore'
import { useLiveStore } from './liveStore'

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

describe('lightboxStore', () => {
  beforeEach(() => useLightboxStore.getState().close())

  it('opens on a valid position and ignores an empty list', () => {
    useLightboxStore.getState().show([], 0)
    expect(useLightboxStore.getState().open).toBe(false)
    useLightboxStore.getState().show([asset('a'), asset('b')], 9)
    expect(useLightboxStore.getState()).toMatchObject({ open: true, index: 1 })
  })

  it('moves within the list and patches an asset', () => {
    const { show, setIndex, patch } = useLightboxStore.getState()
    show([asset('a'), asset('b')], 0)
    setIndex(5)
    expect(useLightboxStore.getState().index).toBe(1)
    patch(asset('a', true))
    expect(useLightboxStore.getState().items[0].favorite).toBe(true)
  })

  it('drops an asset, keeps the position valid and closes when empty', () => {
    const { show, drop } = useLightboxStore.getState()
    show([asset('a'), asset('b')], 1)
    drop('b')
    expect(useLightboxStore.getState()).toMatchObject({ open: true, index: 0 })
    drop('a')
    expect(useLightboxStore.getState()).toMatchObject({ open: false, items: [] })
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
