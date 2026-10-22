/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Asset } from '@/modules/studio-core/types'
import { useVideoDraftStore } from './videoDraftStore'

const asset = (id: string, media: Asset['media'] = 'image') => ({ id, media }) as Asset

beforeEach(() => {
  useVideoDraftStore.setState({ prompt: '', start: null, end: null, source: null, uploads: [], paramsByModel: {}, count: 1, seed: null })
})

describe('video draft', () => {
  it('fills and empties each slot on its own, and clears the three at once', () => {
    const draft = useVideoDraftStore.getState()
    draft.setSlot('start', asset('a'))
    draft.setSlot('end', asset('b'))
    draft.setSlot('source', asset('v', 'video'))
    expect(useVideoDraftStore.getState()).toMatchObject({ start: { id: 'a' }, end: { id: 'b' }, source: { id: 'v' } })
    draft.setSlot('end', null)
    expect(useVideoDraftStore.getState().end).toBeNull()
    expect(useVideoDraftStore.getState().start?.id).toBe('a')
    draft.clearSlots()
    expect(useVideoDraftStore.getState()).toMatchObject({ start: null, end: null, source: null })
  })

  it('tracks the imports in progress', () => {
    const draft = useVideoDraftStore.getState()
    draft.updateUploads((uploads) => [...uploads, { id: 'u1', slot: 'start', name: 'a.png', progress: 0 }])
    draft.updateUploads((uploads) => uploads.map((u) => (u.id === 'u1' ? { ...u, progress: 0.5 } : u)))
    expect(useVideoDraftStore.getState().uploads).toEqual([{ id: 'u1', slot: 'start', name: 'a.png', progress: 0.5 }])
    draft.updateUploads((uploads) => uploads.filter((u) => u.id !== 'u1'))
    expect(useVideoDraftStore.getState().uploads).toEqual([])
  })

  it('keeps the parameters of each model apart, merges patches and resets one model', () => {
    const draft = useVideoDraftStore.getState()
    draft.setParams('wan', { seconds: 3 })
    draft.setParams('wan', { aspect: '9:16' })
    draft.setParams('ltx', { seconds: 8 })
    expect(useVideoDraftStore.getState().paramsByModel).toEqual({ wan: { seconds: 3, aspect: '9:16' }, ltx: { seconds: 8 } })
    draft.resetParams('wan')
    expect(useVideoDraftStore.getState().paramsByModel).toEqual({ ltx: { seconds: 8 } })
  })

  it('sets the prompt, the number of clips and the seed', () => {
    const draft = useVideoDraftStore.getState()
    draft.setPrompt('un chat')
    draft.setCount(2)
    draft.setSeed(7)
    expect(useVideoDraftStore.getState()).toMatchObject({ prompt: 'un chat', count: 2, seed: 7 })
  })
})
