/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset, Message } from '../types'
import {
  buildSlots, developingFilter, downloadName, isActive, isFresh, messageRatio, progressFraction, queueIndex, ratioOf, reusedSettings, statusLine, tileLayout,
} from './messageState'

const asset = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'generated', media: 'image', url: '', thumb_url: '', width: 1024, height: 1024, seed: 7, original_name: null, favorite: false, meta: {}, created_at: 100, ...extra }) as Asset

const message = (extra: Partial<Message> = {}): Message =>
  ({ id: 'm1', conversation_id: 'c1', parent_id: 'u1', role: 'assistant', prompt: 'p', model_id: 'flux', params: { count: 2 }, status: 'running', error: null, created_at: 10, started_at: 20, finished_at: null, references: [], outputs: [], ...extra }) as Message

describe('statuses and ratios', () => {
  it('knows the busy statuses', () => {
    expect(['queued', 'loading', 'running'].every((s) => isActive(s as Message['status']))).toBe(true)
    expect(['done', 'error', 'cancelled'].some((s) => isActive(s as Message['status']))).toBe(false)
  })

  it('parses ratios and rejects auto/custom', () => {
    expect(ratioOf('16:9')).toBeCloseTo(1.7778, 3)
    expect(ratioOf('auto')).toBeNull()
    expect(ratioOf('custom')).toBeNull()
  })

  it('takes the resolved size first, then the aspect, then a square', () => {
    expect(messageRatio({ width: 800, height: 400 })).toBe(2)
    expect(messageRatio({ aspect: '4:5' })).toBe(0.8)
    expect(messageRatio({ aspect: 'auto' })).toBe(1)
    expect(messageRatio({})).toBe(1)
  })
})

describe('buildSlots', () => {
  it('fills the produced images then develops the next one while running', () => {
    const slots = buildSlots(message({ outputs: [asset('a')], params: { count: 3 } }), 1)
    expect(slots.map((s) => s.kind)).toEqual(['image', 'developing', 'waiting'])
  })

  it('develops the first cell when the index is unknown, and only when running', () => {
    expect(buildSlots(message({ params: { count: 2 } }), undefined).map((s) => s.kind)).toEqual(['developing', 'waiting'])
    expect(buildSlots(message({ status: 'loading', params: { count: 2 } }), 0).map((s) => s.kind)).toEqual(['waiting', 'waiting'])
  })

  it('shows nothing for the missing images of a finished generation', () => {
    expect(buildSlots(message({ status: 'cancelled', outputs: [asset('a')], params: { count: 4 } }), 0).map((s) => s.kind)).toEqual(['image'])
    expect(buildSlots(message({ status: 'error', params: {} }), 0)).toEqual([])
  })

  it('defaults to one image', () => {
    expect(buildSlots(message({ status: 'queued', params: {} }), undefined)).toHaveLength(1)
  })
})

describe('layout and preview', () => {
  it('uses one column for a single image and two beyond', () => {
    expect(tileLayout(1, 1)).toEqual({ cols: 1, maxWidth: Math.min(640, 520) })
    expect(tileLayout(1, 4).maxWidth).toBe(640)
    expect(tileLayout(4, 1)).toEqual({ cols: 2, maxWidth: 560 })
    expect(tileLayout(2, 4).maxWidth).toBe(640)
  })

  it('computes the fraction safely', () => {
    expect(progressFraction(undefined)).toBe(0)
    expect(progressFraction({ step: 5, total: 20 })).toBe(0.25)
    expect(progressFraction({ step: 30, total: 20 })).toBe(1)
    expect(progressFraction({ step: 3 })).toBe(0)
  })

  it('removes the blur and the tint at the end', () => {
    expect(developingFilter(1)).toBe('blur(0px) sepia(0) saturate(1) hue-rotate(-12deg)')
    expect(developingFilter(0)).toContain('blur(22px)')
  })

  it('flags images younger than 8 seconds as fresh', () => {
    expect(isFresh({ created_at: 100 }, 107)).toBe(true)
    expect(isFresh({ created_at: 100 }, 108)).toBe(false)
  })
})

describe('queueIndex', () => {
  it('is the position in the generation queue, zero-based', () => {
    expect(queueIndex(['a', 'b', 'c'], 'a')).toBe(0)
    expect(queueIndex(['a', 'b', 'c'], 'c')).toBe(2)
  })

  it('is -1 for a message that does not wait (or while the queue is not known)', () => {
    expect(queueIndex(['a'], 'z')).toBe(-1)
    expect(queueIndex([], 'a')).toBe(-1)
  })
})

describe('statusLine', () => {
  const ctx = { now: 100, queueIndex: -1, modelInstalled: true }

  it('shows the position of a waiting message only from the second', () => {
    expect(statusLine(message({ status: 'queued' }), undefined, { ...ctx, queueIndex: 0 })).toEqual({ kind: 'queued', position: null })
    expect(statusLine(message({ status: 'queued' }), undefined, { ...ctx, queueIndex: 2 })).toEqual({ kind: 'queued', position: 3 })
  })

  it('counts the loading time from the worker, then the message start, then now', () => {
    expect(statusLine(message({ status: 'loading' }), { message_id: 'm1', load_started_at: 90 }, ctx)).toEqual({ kind: 'loading', elapsed: 10, downloadable: false })
    expect(statusLine(message({ status: 'loading', started_at: 80 }), undefined, { ...ctx, modelInstalled: false })).toEqual({ kind: 'loading', elapsed: 20, downloadable: true })
    expect(statusLine(message({ status: 'loading', started_at: null }), undefined, ctx)).toMatchObject({ elapsed: 0 })
  })

  it('reports the step, the image and the remaining time while running', () => {
    expect(statusLine(message(), { message_id: 'm1', step: 4, total: 20, index: 1, eta: 30 }, ctx)).toEqual({ kind: 'running', step: 4, total: 20, image: 2, eta: 30 })
    expect(statusLine(message({ params: { count: 1 } }), { message_id: 'm1', step: 0, total: 20, eta: 5 }, ctx)).toEqual({ kind: 'running', step: null, total: 20, image: null, eta: null })
  })

  it('summarizes a finished generation, with its duration only when done', () => {
    const done = message({ status: 'done', params: { width: 1024, height: 768, steps: 8, references_used: 2 }, started_at: 20, finished_at: 52 })
    expect(statusLine(done, undefined, ctx)).toEqual({ kind: 'meta', size: '1024×768', steps: 8, references: 2, duration: 32, createdAt: 10 })
    expect(statusLine({ ...done, status: 'cancelled' }, undefined, ctx)).toMatchObject({ duration: null })
  })
})

describe('reusedSettings', () => {
  it('drops the resolved fields and pins the first seed', () => {
    const reused = reusedSettings({ model_id: 'flux', params: { aspect: '4:5', steps: 8, width: 832, height: 1040, seeds: [11, 12], seed: 11, count: 2, references_used: 1 } })
    expect(reused).toEqual({ modelId: 'flux', params: { aspect: '4:5', steps: 8 }, count: 2, seed: 11 })
  })

  it('keeps the size of a custom aspect', () => {
    expect(reusedSettings({ model_id: 'flux', params: { aspect: 'custom', width: 640, height: 384 } })?.params).toEqual({ aspect: 'custom', width: 640, height: 384 })
  })

  it('gives nothing without a model', () => {
    expect(reusedSettings({ model_id: null, params: {} })).toBeNull()
  })
})

describe('downloadName', () => {
  it('slugs the prompt and uses the seed', () => {
    expect(downloadName(asset('x', { meta: { prompt: 'Portrait en clair-obscur, loupe à l’œil' }, seed: 42 }))).toBe('portrait-en-clair-obscur-loupe-a-l-il-42.png')
  })

  it('falls back to the media name, the id and the video extension', () => {
    expect(downloadName(asset('abc', { seed: null }))).toBe('image-abc.png')
    expect(downloadName(asset('v1', { media: 'video', seed: null }))).toBe('video-v1.mp4')
  })
})
