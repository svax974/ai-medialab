/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { autoLimitGb, effectiveLimitGb, limitBounds, reserveGb } from './memoryLimit'

describe('memory ceiling', () => {
  it('keeps the engine rule for the reserve: 8 % with a 2.5 GB floor', () => {
    expect(reserveGb(36)).toBe(2.9)
    expect(reserveGb(16)).toBe(2.5)
  })

  it('is 80 % of the machine when automatic', () => {
    expect(autoLimitGb(36)).toBe(28.8)
    expect(effectiveLimitGb(0, 36)).toBe(28.8)
  })

  it('offers a range from 4 GB to what the reserve leaves', () => {
    expect(limitBounds(36)).toEqual({ min: 4, max: 33 })
    expect(limitBounds(4)).toEqual({ min: 4, max: 4 })
  })

  it('shows the engine clamp for a setting above the range', () => {
    expect(effectiveLimitGb(20, 36)).toBe(20)
    expect(effectiveLimitGb(99, 36)).toBe(33)
  })
})
