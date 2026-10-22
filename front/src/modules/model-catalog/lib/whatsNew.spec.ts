/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { TrendingOption } from '../types'
import { ageOf, downloadGb, licenseNoteKey, markSeen, newSince, readSeen, toHubResult, WINDOWS } from './whatsNew'

/** A `Storage` in memory; `broken` makes every access throw, as a private window or blocked site data does. */
function fakeStorage(broken = false): Storage {
  const data = new Map<string, string>()
  const fail = () => {
    if (broken) throw new Error('storage blocked')
  }
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => (fail(), data.get(key) ?? null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => (fail(), void data.set(key, value)),
  }
}

describe('ageOf', () => {
  it.each([
    [0, 'today', 0],
    [0.4, 'today', 0],
    [1, 'days', 1],
    [12, 'days', 12],
    [14, 'weeks', 2],
    [45, 'weeks', 6],
    [60, 'months', 2],
    [200, 'months', 6],
  ])('%s days is %s %s', (days, unit, count) => {
    expect(ageOf(days)).toEqual({ unit, count })
  })
})

describe('downloadGb', () => {
  const option = (over: Partial<TrendingOption>): TrendingOption => ({ key: 'k', label: 'Q4_K_M', precision: 'Q4_K_M', size_gb: 4.5, download_gb: null, fits: true, fit_note: null, ...over })
  it('is what adding downloads, else the file size, else unknown', () => {
    expect(downloadGb(option({ download_gb: 7.1 }))).toBe(7.1)
    expect(downloadGb(option({ download_gb: 0 }))).toBe(0) // everything already in the cache
    expect(downloadGb(option({}))).toBe(4.5)
    expect(downloadGb(null)).toBeNull()
  })
})

describe('the badge of new models', () => {
  it('remembers per kind when the list was last opened', () => {
    const store = fakeStorage()
    expect(readSeen('image', store)).toBe(0)
    markSeen('image', 1_700_000_000_000, store)
    expect(readSeen('image', store)).toBe(1_700_000_000_000)
    expect(readSeen('audio', store)).toBe(0)
  })

  it('works without any storage: nothing is remembered, nothing throws', () => {
    for (const store of [null, fakeStorage(true)]) {
      expect(() => markSeen('video', 5, store)).not.toThrow()
      expect(readSeen('video', store)).toBe(0)
    }
  })

  it('ignores a stored value that is not a date', () => {
    const store = fakeStorage()
    store.setItem('cn-whatsnew-seen-llm', 'soon')
    expect(readSeen('llm', store)).toBe(0)
  })

  it('counts the models published since the last visit, all of them for a first visit', () => {
    const entries = [{ created_at: '2026-10-10T00:00:00Z' }, { created_at: '2026-10-01T00:00:00Z' }, { created_at: '2026-09-01T00:00:00Z' }]
    expect(newSince(entries, 0)).toBe(3)
    expect(newSince(entries, Date.parse('2026-10-05T00:00:00Z'))).toBe(1)
    expect(newSince(entries, Date.parse('2026-10-20T00:00:00Z'))).toBe(0)
    expect(newSince([], 0)).toBe(0)
  })
})

describe('what the add detail of the search needs', () => {
  it('reuses the repository and says it is not in the list yet', () => {
    expect(toHubResult({ repo: 'acme/model' })).toEqual({ repo: 'acme/model', already: null })
  })
  it('names the note of a licence that is not plainly open', () => {
    expect(licenseNoteKey('noncommercial')).toBe('models.new.license.noncommercial')
  })
  it('offers 30, 90 and 180 days, 90 first', () => {
    expect([...WINDOWS].sort((a, b) => a - b)).toEqual([30, 90, 180])
    expect(WINDOWS[0]).toBe(90)
  })
})
