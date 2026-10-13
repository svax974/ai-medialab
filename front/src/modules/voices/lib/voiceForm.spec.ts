/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { buildVoiceForm, buildVoicePatch, canSaveVoice, draftOfVoice, firstAudioFile, isTooShort, nameFromFile } from './voiceForm'

const file = (name: string, type = '') => ({ name, type, size: 10 })

describe('voice form rules', () => {
  it('proposes a name from the file name: no extension, separators as spaces, 60 characters', () => {
    expect(nameFromFile('ma_voix-claire.m4a')).toBe('ma voix claire')
    expect(nameFromFile('x'.repeat(80) + '.wav')).toHaveLength(60)
    expect(nameFromFile('')).toBe('')
  })

  it('knows a sample is too short only when its duration is known and under a second', () => {
    expect(isTooShort(0.4)).toBe(true)
    expect(isTooShort(1)).toBe(false)
    expect(isTooShort(0)).toBe(false)
    expect(isTooShort(null)).toBe(false)
    expect(isTooShort(undefined)).toBe(false)
  })

  it('keeps the first sound file of a drop, by type or by extension, and none when no file is a sound', () => {
    expect(firstAudioFile([file('a.png', 'image/png'), file('b.wav'), file('c.mp3', 'audio/mpeg')])?.name).toBe('b.wav')
    expect(firstAudioFile([file('clip', 'audio/ogg')])?.name).toBe('clip')
    expect(firstAudioFile([file('a.png', 'image/png'), file('notes.txt', 'text/plain')])).toBeNull()
    expect(firstAudioFile([])).toBeNull()
  })

  it('builds the creation body with the file, the trimmed name (or "Ma voix"), the transcript and the language', () => {
    const wav = new File(['x'], 'v.wav')
    const form = buildVoiceForm(wav, { name: '  Alice ', transcript: 'bonjour', language: 'fr' })
    expect(form.get('name')).toBe('Alice')
    expect(form.get('transcript')).toBe('bonjour')
    expect(form.get('language')).toBe('fr')
    expect((form.get('file') as File).name).toBe('v.wav')
    expect(buildVoiceForm(wav, { name: '  ', transcript: '', language: 'en' }).get('name')).toBe('Ma voix')
  })

  it('builds the update body: name, transcript (kept as typed, even empty) and language', () => {
    expect(buildVoicePatch({ name: ' Bob ', transcript: '', language: 'en' })).toEqual({ name: 'Bob', transcript: '', language: 'en' })
    expect(buildVoicePatch({ name: '', transcript: 'x', language: 'fr' }).name).toBe('Ma voix')
  })

  it('shows a voice being edited in the form, with French as the language of a voice that has none', () => {
    expect(draftOfVoice({ name: 'A', language: null, transcript: 't' })).toEqual({ name: 'A', language: 'fr', transcript: 't' })
    expect(draftOfVoice({ name: 'A', language: 'en', transcript: '' }).language).toBe('en')
  })

  it('allows saving only with a sample, a name, nothing running and a long enough sample', () => {
    const ok = { hasAudio: true, name: 'A', busy: false, previewDuration: 5 }
    expect(canSaveVoice(ok)).toBe(true)
    expect(canSaveVoice({ ...ok, hasAudio: false })).toBe(false)
    expect(canSaveVoice({ ...ok, name: '  ' })).toBe(false)
    expect(canSaveVoice({ ...ok, busy: true })).toBe(false)
    expect(canSaveVoice({ ...ok, previewDuration: 0.5 })).toBe(false)
    expect(canSaveVoice({ ...ok, previewDuration: undefined })).toBe(true)
  })
})
