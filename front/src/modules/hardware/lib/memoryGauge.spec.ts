/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { gaugeTone, gaugeWidth, swapIsHeavy } from './memoryGauge'

describe('gaugeTone', () => {
  it('is green while the system is fine and the share in use is moderate', () => {
    expect(gaugeTone({ used_pct: 79, pressure: 'normal' })).toBe('ok')
  })

  it('turns amber on a warning pressure or from 85 %, red on a critical one or from 93 %', () => {
    expect(gaugeTone({ used_pct: 40, pressure: 'warning' })).toBe('warn')
    expect(gaugeTone({ used_pct: 85, pressure: 'normal' })).toBe('warn')
    expect(gaugeTone({ used_pct: 40, pressure: 'critical' })).toBe('danger')
    expect(gaugeTone({ used_pct: 93, pressure: 'normal' })).toBe('danger')
  })
})

describe('gauge helpers', () => {
  it('keeps the bar inside its track', () => {
    expect([gaugeWidth(-3), gaugeWidth(79.4), gaugeWidth(120)]).toEqual([0, 79, 100])
  })

  it('flags a swap above a quarter of the memory', () => {
    expect(swapIsHeavy({ swap_used_gb: 4, total_gb: 36 })).toBe(false)
    expect(swapIsHeavy({ swap_used_gb: 12, total_gb: 36 })).toBe(true)
  })
})
