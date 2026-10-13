/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { ASPECTS, QUALITIES, aspectLabel, isQualityActive, resolveSize, visibleQualities } from './size'

const model = { size_multiple: 16, min_side: 256, max_side: 2048, default_megapixels: 1 }

describe('resolveSize', () => {
  it('computes a square at the default definition', () => {
    expect(resolveSize({}, model)).toEqual({ width: 1024, height: 1024 })
    expect(resolveSize({ aspect: '1:1', megapixels: 0.5 }, model)).toEqual({ width: 720, height: 720 })
  })

  it('applies the aspect ratio at the requested megapixels, snapped to the multiple', () => {
    expect(resolveSize({ aspect: '16:9' }, model)).toEqual({ width: 1360, height: 768 })
    expect(resolveSize({ aspect: '9:16' }, model)).toEqual({ width: 768, height: 1360 })
    expect(resolveSize({ aspect: '4:5', megapixels: 1.6 }, model)).toEqual({ width: 1152, height: 1456 })
  })

  it('bounds the definition between 0.1 and 4 megapixels and the sides to the model maximum', () => {
    expect(resolveSize({ megapixels: 99 }, { ...model, max_side: 4096 }).width).toBe(2048)
    expect(resolveSize({ megapixels: 0.0001 }, model).width).toBe(320)
    expect(resolveSize({ aspect: '21:9', megapixels: 4 }, { ...model, max_side: 1024 })).toEqual({ width: 1024, height: 432 })
  })

  it('snaps a custom size to the multiple and the bounds', () => {
    expect(resolveSize({ aspect: 'custom', width: 1000, height: 100 }, model)).toEqual({ width: 1008, height: 256 })
    expect(resolveSize({ aspect: 'custom', width: 9999, height: 513 }, model)).toEqual({ width: 2048, height: 512 })
    expect(resolveSize({ aspect: 'custom' }, model)).toEqual({ width: 1024, height: 1024 })
  })

  it('follows the reference in auto mode: its ratio at a chosen definition, its size capped at "original"', () => {
    const reference = { width: 3000, height: 2000 }
    expect(resolveSize({ aspect: 'auto', megapixels: 1 }, model, reference)).toEqual({ width: 1248, height: 832 })
    expect(resolveSize({ aspect: 'auto', megapixels: 0 }, model, reference)).toEqual({ width: 1584, height: 1056 })
    expect(resolveSize({ aspect: 'auto', megapixels: 0 }, model, { width: 800, height: 600 })).toEqual({ width: 800, height: 608 })
  })

  it('falls back to a square in auto mode without a usable reference', () => {
    expect(resolveSize({ aspect: 'auto' }, model, null)).toEqual({ width: 1024, height: 1024 })
    expect(resolveSize({ aspect: 'auto' }, model, { width: null, height: null })).toEqual({ width: 1024, height: 1024 })
    expect(resolveSize({ aspect: 'weird' }, model)).toEqual({ width: 1024, height: 1024 })
  })
})

describe('qualities and labels', () => {
  it('offers "Original" only for an auto format with a reference', () => {
    expect(visibleQualities(true, 'auto').map((q) => q.mp)).toEqual([0, 0.5, 1, 1.6, 2.3])
    expect(visibleQualities(true, '1:1').map((q) => q.mp)).toEqual([0.5, 1, 1.6, 2.3])
    expect(visibleQualities(false, 'auto')).toHaveLength(4)
  })

  it('finds the selected definition, the model default when none is set', () => {
    expect(isQualityActive({}, model, 1)).toBe(true)
    expect(isQualityActive({ megapixels: 1.6 }, model, 1.6)).toBe(true)
    expect(isQualityActive({ megapixels: 1.6 }, model, 1)).toBe(false)
    expect(isQualityActive({ megapixels: 0 }, model, 0)).toBe(true)
  })

  it('labels auto and custom by key and a ratio by itself', () => {
    expect(aspectLabel('auto')).toEqual({ key: 'imageStudio.aspect.auto' })
    expect(aspectLabel('custom')).toEqual({ key: 'imageStudio.aspect.custom' })
    expect(aspectLabel('4:3')).toEqual({ text: '4:3' })
  })

  it('lists ten aspects with a name key each and five definitions', () => {
    expect(ASPECTS).toHaveLength(10)
    expect(ASPECTS.every((a) => a.labelKey.startsWith('imageStudio.aspect.'))).toBe(true)
    expect(QUALITIES.map((q) => q.mp)).toEqual([0, 0.5, 1, 1.6, 2.3])
  })
})
