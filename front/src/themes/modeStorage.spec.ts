/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODE_STORAGE_KEY, parseMode, readStoredMode, storeMode } from './modeStorage'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

afterEach(() => vi.unstubAllGlobals())

describe('theme mode storage', () => {
  it('is dark unless light was explicitly chosen', () => {
    expect(parseMode(null)).toBe('dark')
    expect(parseMode('dark')).toBe('dark')
    expect(parseMode('anything')).toBe('dark')
    expect(parseMode('light')).toBe('light')
  })

  it('reads and writes the choice under the former key', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    expect(readStoredMode()).toBe('dark')
    storeMode('light')
    expect(storage.data[MODE_STORAGE_KEY]).toBe('light')
    expect(readStoredMode()).toBe('light')
    expect(MODE_STORAGE_KEY).toBe('cn-theme')
  })

  it('falls back to dark when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readStoredMode()).toBe('dark')
    expect(() => storeMode('light')).not.toThrow()
  })
})
