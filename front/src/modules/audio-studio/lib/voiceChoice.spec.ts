/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { AudioCaps } from '@/modules/model-catalog'
import type { Voice } from '@/modules/voices'
import { castPool, castVoiceFor, defaultLanguage, effectiveVoice, isScriptActive, presetsFor } from './voiceChoice'

const caps = (extra: Partial<AudioCaps> = {}): AudioCaps => ({
  task: 'tts', languages: [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }], clone: 'optional', instruct: false, instruct_help: '', design: false, speed: true, tags: [], max_chars: 500, sample_rate: 24000,
  voices: [
    { id: 'ff_siwis', name: 'Siwis', language: 'fr', gender: 'f', description: '' },
    { id: 'fm_pierre', name: 'Pierre', language: 'fr', gender: 'm', description: '' },
    { id: 'af_heart', name: 'Heart', language: 'en', gender: 'f', description: '' },
    { id: 'any', name: 'Neutre', language: '*', gender: 'n', description: '' },
  ],
  ...extra,
})
const voice = (id: string, name = id): Voice => ({ id, name, kind: 'clone', transcript: '', description: '', language: 'fr', duration: 5, peaks: [], url: `/media/uploads/${id}.wav`, created_at: 1 })

describe('presets and language', () => {
  it('keeps the built-in voices of the language and the universal ones', () => {
    expect(presetsFor(caps(), 'fr').map((v) => v.id)).toEqual(['ff_siwis', 'fm_pierre', 'any'])
    expect(presetsFor(caps(), 'en').map((v) => v.id)).toEqual(['af_heart', 'any'])
    expect(presetsFor(caps(), 'de').map((v) => v.id)).toEqual(['any'])
  })

  it('takes the stored language if the model has it, else the interface language, else French, else the first', () => {
    expect(defaultLanguage(caps(), 'en', 'fr')).toBe('en')
    expect(defaultLanguage(caps(), 'zz', 'en-US')).toBe('en')
    expect(defaultLanguage(caps(), undefined, 'de')).toBe('fr')
    expect(defaultLanguage(caps({ languages: [{ code: 'en', label: 'English' }] }), undefined, 'de')).toBe('en')
    expect(defaultLanguage(caps({ languages: [] }), undefined, '')).toBe('en')
  })
})

describe('effectiveVoice', () => {
  it('uses the library voice when the model can clone and the voice exists', () => {
    expect(effectiveVoice(caps(), { source: 'library', id: 'v1' }, 'fr', [voice('v1', 'Moi')])).toMatchObject({ ref: { source: 'library', id: 'v1' }, name: 'Moi' })
  })

  it('falls back on the first built-in voice when the model cannot clone or the voice is gone', () => {
    expect(effectiveVoice(caps({ clone: 'none' }), { source: 'library', id: 'v1' }, 'fr', [voice('v1')]).ref).toEqual({ source: 'preset', id: 'ff_siwis' })
    expect(effectiveVoice(caps(), { source: 'library', id: 'gone' }, 'fr', []).ref).toEqual({ source: 'preset', id: 'ff_siwis' })
  })

  it('keeps the chosen built-in voice if it fits the language, else the first one', () => {
    expect(effectiveVoice(caps(), { source: 'preset', id: 'fm_pierre' }, 'fr', undefined).name).toBe('Pierre')
    expect(effectiveVoice(caps(), { source: 'preset', id: 'af_heart' }, 'fr', undefined).name).toBe('Siwis')
  })

  it('has no voice when nothing fits (a cloning-only model with an empty library)', () => {
    expect(effectiveVoice(caps({ voices: [], clone: 'required' }), undefined, 'fr', [])).toEqual({ ref: undefined, name: '' })
  })
})

describe('casting a dialogue', () => {
  const library = [voice('v1')]
  const pool = castPool(caps(), 'fr', library)
  const main = effectiveVoice(caps(), undefined, 'fr', library)

  it('offers the built-in voices then the library when the model can clone', () => {
    expect(pool).toEqual([{ source: 'preset', id: 'ff_siwis' }, { source: 'preset', id: 'fm_pierre' }, { source: 'preset', id: 'any' }, { source: 'library', id: 'v1' }])
    expect(castPool(caps({ clone: 'none' }), 'fr', library).some((v) => v.source === 'library')).toBe(false)
  })

  it('gives the first character the main voice and the others voices of the opposite gender first', () => {
    const cast = (name: string, index: number) => castVoiceFor({ name, index, cast: {}, pool, main, caps: caps() })
    expect(cast('Alice', 0)).toEqual({ source: 'preset', id: 'ff_siwis' })
    expect(cast('Marc', 1)).toEqual({ source: 'preset', id: 'fm_pierre' })
    expect(cast('Zoé', 2)).toEqual({ source: 'preset', id: 'any' })
  })

  it('keeps the user choice while it is in the pool, ignores one that is gone', () => {
    const chosen = { source: 'library', id: 'v1' } as const
    expect(castVoiceFor({ name: 'Marc', index: 1, cast: { Marc: chosen }, pool, main, caps: caps() })).toEqual(chosen)
    expect(castVoiceFor({ name: 'Marc', index: 1, cast: { Marc: { source: 'library', id: 'gone' } }, pool, main, caps: caps() })).toEqual({ source: 'preset', id: 'fm_pierre' })
  })

  it('wraps around when there are more characters than voices', () => {
    const small = [{ source: 'preset', id: 'ff_siwis' }, { source: 'preset', id: 'fm_pierre' }] as const
    const m = effectiveVoice(caps(), undefined, 'fr', undefined)
    expect(castVoiceFor({ name: 'C', index: 2, cast: {}, pool: small, main: m, caps: caps() })).toEqual({ source: 'preset', id: 'fm_pierre' })
  })

  it('is a script only with two characters, the script mode on, a model that does not invent voices and a pool', () => {
    const ok = { scriptMode: true, speakers: ['A', 'B'], caps: caps(), poolSize: 3 }
    expect(isScriptActive(ok)).toBe(true)
    expect(isScriptActive({ ...ok, scriptMode: false })).toBe(false)
    expect(isScriptActive({ ...ok, speakers: ['A'] })).toBe(false)
    expect(isScriptActive({ ...ok, caps: caps({ design: true }) })).toBe(false)
    expect(isScriptActive({ ...ok, poolSize: 0 })).toBe(false)
  })
})
