/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { LOW_DISK_GB, formatGb, gpuKind, isDiskLow } from './machine'

const gpu = (backend: string) => ({ vendor: 'x', backend, name: 'n', memory_gb: 8, unified: false })

describe('formatGb', () => {
  it('uses one decimal below 10 and none from 10 up', () => {
    expect(formatGb(7.46, 'en')).toBe('7.5')
    expect(formatGb(9, 'en')).toBe('9.0')
    expect(formatGb(31.7, 'en')).toBe('32')
  })
  it('uses the decimal comma in French', () => {
    expect(formatGb(7.46, 'fr')).toBe('7,5')
  })
})

describe('gpuKind', () => {
  it('maps the backend of the first accelerator', () => {
    expect(gpuKind(undefined)).toBe('none')
    expect(gpuKind(gpu('metal'))).toBe('metal')
    expect(gpuKind(gpu('rocm'))).toBe('rocm')
    expect(gpuKind(gpu('cuda'))).toBe('cuda')
    expect(gpuKind(gpu('vulkan'))).toBe('cuda')
  })
})

describe('isDiskLow', () => {
  it('flags the models disk under the threshold', () => {
    expect(isDiskLow({ disk: { free_gb: LOW_DISK_GB - 1, total_gb: 500 } })).toBe(true)
    expect(isDiskLow({ disk: { free_gb: LOW_DISK_GB, total_gb: 500 } })).toBe(false)
  })
})
