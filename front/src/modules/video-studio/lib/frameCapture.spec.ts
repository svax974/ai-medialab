/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { captureTime, FrameCaptureError } from './frameCapture'

describe('captureTime', () => {
  it('takes the last frame a hair before the end, never before the start', () => {
    expect(captureTime('last', 5)).toBeCloseTo(4.94)
    expect(captureTime('last', 0.02)).toBe(0)
  })

  it('takes a given moment, not beyond the end', () => {
    expect(captureTime(2, 5)).toBe(2)
    expect(captureTime(9, 5)).toBe(5)
  })
})

describe('FrameCaptureError', () => {
  it('carries the locale key of what went wrong', () => {
    const error = new FrameCaptureError('videoStudio.capture.failed')
    expect(error.key).toBe('videoStudio.capture.failed')
    expect(error).toBeInstanceOf(Error)
  })
})
