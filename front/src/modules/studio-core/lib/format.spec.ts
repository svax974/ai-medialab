/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { formatDay, formatMegapixels, formatSeconds, formatTime } from './format'

describe('format', () => {
  const ts = new Date(2026, 9, 13, 14, 5).getTime() / 1000

  it('formats the time of day in the language', () => {
    expect(formatTime(ts, 'fr')).toBe('14:05')
    expect(formatTime(ts, 'en-GB')).toBe('14:05')
    expect(formatTime(ts, 'en')).toMatch(/^0?2:05\s?PM$/i)
  })

  it('formats the day with a short month', () => {
    expect(formatDay(ts, 'fr')).toMatch(/^13 oct/)
    expect(formatDay(ts, 'en')).toMatch(/Oct/)
  })

  it('formats megapixels with two decimals', () => {
    expect(formatMegapixels(1024, 1024)).toBe('1.05 MP')
    expect(formatMegapixels(1280, 720)).toBe('0.92 MP')
  })

  it('formats a clip length with at most one decimal', () => {
    expect(formatSeconds(5, 'fr')).toMatch(/^5\s+s$/)
    expect(formatSeconds(5.46, 'fr')).toMatch(/^5,5\s+s$/)
    expect(formatSeconds(5.5, 'en')).toMatch(/^5\.5\s?sec$/)
  })
})
