/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { DownloadProgress } from '../types'
import { activeDownload, downloadError, isDownloadFinished, parseDownloadProgress, upsertDownload } from './downloads'

const progress = (over: Partial<DownloadProgress>): DownloadProgress => ({ model_id: 'm', state: 'running', done: 1, total: 10, rate: 5, eta: 2, error: null, ...over })

describe('activeDownload', () => {
  it('prefers the live running download, then the one of the catalogue', () => {
    expect(activeDownload(progress({ done: 5 }), { download: progress({ done: 1 }) })?.done).toBe(5)
    expect(activeDownload(undefined, { download: progress({ done: 1 }) })?.done).toBe(1)
  })
  it('ignores finished or failed downloads', () => {
    expect(activeDownload(progress({ state: 'done' }), { download: null })).toBeNull()
    expect(activeDownload(undefined, { download: progress({ state: 'error' }) })).toBeNull()
  })
  it('a finished live download hides nothing: the catalogue running one still shows', () => {
    expect(activeDownload(progress({ state: 'cancelled' }), { download: progress({ done: 3 }) })?.done).toBe(3)
  })
})

describe('downloadError', () => {
  it('reads the live error first, then the catalogue one', () => {
    expect(downloadError(progress({ state: 'error', error: 'live' }), { download: progress({ state: 'error', error: 'cat' }) })).toBe('live')
    expect(downloadError(undefined, { download: progress({ state: 'error', error: 'cat' }) })).toBe('cat')
    expect(downloadError(progress({ state: 'running' }), { download: null })).toBeNull()
  })
})

describe('events', () => {
  it('upserts by model id without touching the others', () => {
    const first = upsertDownload({}, progress({ model_id: 'a' }))
    const next = upsertDownload(first, progress({ model_id: 'b', done: 9 }))
    expect(Object.keys(next)).toEqual(['a', 'b'])
    expect(upsertDownload(next, progress({ model_id: 'a', done: 7 })).a.done).toBe(7)
  })
  it('a download is finished as soon as it is not running', () => {
    expect(isDownloadFinished({ state: 'running' })).toBe(false)
    for (const state of ['done', 'error', 'cancelled'] as const) expect(isDownloadFinished({ state })).toBe(true)
  })
  it('parses an event payload and rejects a malformed one', () => {
    expect(parseDownloadProgress({ model_id: 'm', state: 'running', done: '12', total: 100 })).toMatchObject({ done: 12, total: 100, rate: 0, eta: null, error: null })
    expect(parseDownloadProgress(null)).toBeNull()
    expect(parseDownloadProgress({ state: 'running' })).toBeNull()
  })
})
