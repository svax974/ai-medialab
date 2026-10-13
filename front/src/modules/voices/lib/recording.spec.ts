/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { READING, readingFor } from './reading'
import { recordDisabled, recordingHint, recordSubKey } from './recording'

describe('recording', () => {
  it('encourages until 8 s, says nothing in the ideal range and says it is plenty after 30 s', () => {
    expect(recordingHint(0)).toBe('voices.recording.keepGoing')
    expect(recordingHint(7.9)).toBe('voices.recording.keepGoing')
    expect(recordingHint(8)).toBeNull()
    expect(recordingHint(30)).toBeNull()
    expect(recordingHint(30.1)).toBe('voices.recording.enough')
  })

  it('explains why the microphone cannot be used, as a warning when the user can fix it', () => {
    expect(recordSubKey('idle')).toEqual({ key: 'voices.studio.record.sub', warn: false })
    expect(recordSubKey('denied')).toEqual({ key: 'voices.studio.record.denied', warn: true })
    expect(recordSubKey('no-device').warn).toBe(true)
    expect(recordSubKey('unsupported')).toEqual({ key: 'voices.studio.record.unsupported', warn: false })
  })

  it('disables the record button when there is no microphone API or a request or conversion is pending', () => {
    expect(['unsupported', 'requesting', 'processing'].every((state) => recordDisabled(state as never))).toBe(true)
    expect(['idle', 'denied', 'no-device', 'error'].some((state) => recordDisabled(state as never))).toBe(false)
  })

  it('reads the French text for French, the English text for English and for any other language', () => {
    expect(readingFor('fr')).toBe(READING['fr'])
    expect(readingFor('en')).toBe(READING['en'])
    expect(readingFor('ja')).toBe(READING['en'])
    expect(READING['fr']).toMatch(/^Le matin, quand la ville s'éveille/)
  })
})
