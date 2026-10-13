/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { buildAudioRequest } from './sendRequest'

const base = { conversationId: null, prompt: '  Bonjour  ', model: { id: 'tts', audio: { instruct: false, design: false } as never }, params: { speed: 1.1 }, language: 'fr', seed: null, voice: undefined, instruct: '', cast: null, count: 2 }

describe('buildAudioRequest', () => {
  it('sends the trimmed text, the parameters, the language and the seed, with no references', () => {
    expect(buildAudioRequest(base)).toEqual({ conversation_id: null, prompt: 'Bonjour', model_id: 'tts', params: { speed: 1.1, language: 'fr', seed: null }, reference_ids: [], count: 2 })
  })

  it('adds the voice, and the trimmed style when the model takes one (a design model always sends it, even empty)', () => {
    const voice = { source: 'library', id: 'v1' } as const
    expect(buildAudioRequest({ ...base, voice }).params).toMatchObject({ voice })
    expect(buildAudioRequest({ ...base, instruct: ' douce ' }).params).not.toHaveProperty('instruct')
    expect(buildAudioRequest({ ...base, model: { id: 'tts', audio: { instruct: true, design: false } as never }, instruct: ' douce ' }).params).toMatchObject({ instruct: 'douce' })
    expect(buildAudioRequest({ ...base, model: { id: 'd', audio: { instruct: false, design: true } as never } }).params).toMatchObject({ instruct: '' })
  })

  it('sends the cast of a dialogue without the characters that have no voice, and a pinned seed', () => {
    const cast = { Alice: { source: 'preset', id: 'a' } as const, Marc: undefined, Zoé: { source: 'library', id: 'v' } as const }
    expect(buildAudioRequest({ ...base, cast, seed: 42 }).params).toMatchObject({ cast: { Alice: { source: 'preset', id: 'a' }, Zoé: { source: 'library', id: 'v' } }, seed: 42 })
    expect(buildAudioRequest({ ...base, conversationId: 'c1' }).conversation_id).toBe('c1')
  })
})
