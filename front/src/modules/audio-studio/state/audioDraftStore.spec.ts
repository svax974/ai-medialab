/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useAudioDraftStore } from './audioDraftStore'

const reset = () => useAudioDraftStore.setState({ prompt: '', paramsByModel: {}, voiceByModel: {}, languageByModel: {}, instructByModel: {}, cast: {}, count: 1, autoplay: true, seed: null })

describe('audio draft store', () => {
  beforeEach(reset)

  it('keeps the text, the count, autoplay and the seed', () => {
    const draft = useAudioDraftStore.getState()
    draft.setPrompt('Bonjour')
    draft.setCount(3)
    draft.setAutoplay(false)
    draft.setSeed(12)
    expect(useAudioDraftStore.getState()).toMatchObject({ prompt: 'Bonjour', count: 3, autoplay: false, seed: 12 })
  })

  it('keeps parameters, voice, language and style per model, and merges parameter patches', () => {
    const draft = useAudioDraftStore.getState()
    draft.setParams('a', { speed: 1.2 })
    draft.setParams('a', { temperature: 0.5 })
    draft.setParams('b', { speed: 0.9 })
    draft.setVoice('a', { source: 'library', id: 'v' })
    draft.setLanguage('a', 'en')
    draft.setInstruct('a', 'doux')
    const state = useAudioDraftStore.getState()
    expect(state.paramsByModel).toEqual({ a: { speed: 1.2, temperature: 0.5 }, b: { speed: 0.9 } })
    expect(state.voiceByModel['a']).toEqual({ source: 'library', id: 'v' })
    expect(state.languageByModel['a']).toBe('en')
    expect(state.instructByModel['a']).toBe('doux')
    draft.resetParams('a')
    expect(useAudioDraftStore.getState().paramsByModel).toEqual({ b: { speed: 0.9 } })
  })

  it('casts a character with a voice and replaces it', () => {
    const draft = useAudioDraftStore.getState()
    draft.setCast('Alice', { source: 'preset', id: 'a' })
    draft.setCast('Alice', { source: 'preset', id: 'b' })
    expect(useAudioDraftStore.getState().cast).toEqual({ Alice: { source: 'preset', id: 'b' } })
  })
})
