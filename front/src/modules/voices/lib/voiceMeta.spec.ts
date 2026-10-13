/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { avatarGradient, avatarHue, initialOf, voiceFacts, voiceQuote } from './voiceMeta'

describe('voice presentation', () => {
  it('gives a name a stable hue and gradient, and the initial of a built-in voice', () => {
    expect(avatarHue('Alice')).toBe(avatarHue('Alice'))
    expect(avatarHue('Alice')).not.toBe(avatarHue('Marc'))
    expect(avatarHue('Alice')).toBeGreaterThanOrEqual(0)
    expect(avatarHue('Alice')).toBeLessThan(360)
    expect(avatarGradient('Alice')).toMatch(/^linear-gradient\(135deg, hsl\(\d+ 55% 42%\), hsl\(\d+ 60% 28%\)\)$/)
    expect(initialOf('  siwis')).toBe('S')
  })

  it('lists the facts under a name: kind, language, duration, and a missing transcript', () => {
    expect(voiceFacts({ kind: 'clone', language: 'fr', duration: 12.4, transcript: 'x' })).toEqual([
      { kind: 'type', key: 'voices.card.kind.clone' }, { kind: 'language', code: 'fr' }, { kind: 'duration', seconds: 12.4 },
    ])
    expect(voiceFacts({ kind: 'design', language: null, duration: null, transcript: '' })).toEqual([
      { kind: 'type', key: 'voices.card.kind.design' }, { kind: 'noTranscript' },
    ])
  })

  it('quotes the transcript, else the description, else nothing', () => {
    expect(voiceQuote({ transcript: 't', description: 'd' })).toBe('t')
    expect(voiceQuote({ transcript: '', description: 'd' })).toBe('d')
    expect(voiceQuote({ transcript: '', description: '' })).toBeNull()
  })
})
