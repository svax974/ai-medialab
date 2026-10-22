/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset, Message } from '@/modules/studio-core/types'
import { assetRatio, clipFraction, clipLayout, clipRatio, clipSlots, isFreshClip, pendingLabel, reusedVideo, stageKey, videoStatus } from './clips'

const asset = (id: string, extra: Partial<Asset> = {}) => ({ id, media: 'video', created_at: 100, ...extra }) as Asset
const message = (extra: Partial<Message> = {}): Message => ({ id: 'm', conversation_id: 'c', parent_id: 'u', role: 'assistant', prompt: 'un chat', model_id: 'wan', params: {}, status: 'done', error: null, created_at: 1000, started_at: null, finished_at: null, references: [], outputs: [], ...extra })

describe('clipSlots', () => {
  it('draws one cell per requested clip: produced, the one being computed, the ones waiting', () => {
    const running = message({ status: 'running', params: { count: 2 }, outputs: [] })
    expect(clipSlots(running, 0)).toEqual([{ kind: 'pending', running: true }, { kind: 'pending', running: false }])
    expect(clipSlots({ ...running, outputs: [asset('a')] }, 1)).toEqual([{ kind: 'clip', asset: asset('a') }, { kind: 'pending', running: true }])
  })

  it('shows no running cell while the model loads or the message waits', () => {
    expect(clipSlots(message({ status: 'loading', params: { count: 1 } }), undefined)).toEqual([{ kind: 'pending', running: false }])
    expect(clipSlots(message({ status: 'queued' }), undefined)).toEqual([{ kind: 'pending', running: false }])
  })

  it('does not draw the missing clips of a finished or failed generation', () => {
    expect(clipSlots(message({ status: 'done', params: { count: 2 }, outputs: [asset('a')] }), undefined)).toEqual([{ kind: 'clip', asset: asset('a') }])
    expect(clipSlots(message({ status: 'error', params: { count: 2 } }), undefined)).toEqual([])
  })
})

describe('layout and ratio', () => {
  it('uses the requested format, 16:9 by default', () => {
    expect(clipRatio({ aspect: '9:16' })).toBeCloseTo(9 / 16)
    expect(clipRatio({})).toBeCloseTo(16 / 9)
    expect(clipRatio({ aspect: 'auto' })).toBeCloseTo(16 / 9)
  })

  it('draws a single clip wide and two in two columns', () => {
    expect(clipLayout(1, 16 / 9)).toEqual({ cols: 1, maxWidth: 680 })
    expect(clipLayout(1, 9 / 16).maxWidth).toBeCloseTo(520 * Math.sqrt(9 / 16))
    expect(clipLayout(2, 16 / 9)).toEqual({ cols: 2, maxWidth: 680 })
    expect(clipLayout(2, 9 / 16).cols).toBe(2)
  })

  it('takes the clip own ratio once its pixels are known', () => {
    expect(assetRatio({ width: 832, height: 480 }, 1)).toBeCloseTo(832 / 480)
    expect(assetRatio({ width: null, height: null }, 1.5)).toBe(1.5)
  })

  it('reveals a clip with the develop animation during 8 seconds', () => {
    expect(isFreshClip({ created_at: 100 }, 105)).toBe(true)
    expect(isFreshClip({ created_at: 100 }, 108)).toBe(false)
  })
})

describe('progress', () => {
  it('shares the steps of the clip being computed', () => {
    expect(clipFraction({ step: 5, total: 20 }, true)).toBe(0.25)
    expect(clipFraction({ step: 5, total: 20 }, false)).toBe(0)
    expect(clipFraction(undefined, true)).toBe(0)
  })

  it('labels a pending clip: loading, waiting, preparing, step', () => {
    expect(pendingLabel('loading', true, undefined)).toEqual({ key: 'videoStudio.pending.loading' })
    expect(pendingLabel('running', false, undefined)).toEqual({ key: 'videoStudio.pending.waiting' })
    expect(pendingLabel('running', true, undefined)).toEqual({ key: 'thread.status.preparing' })
    expect(pendingLabel('running', true, { step: 3, total: 20 })).toEqual({ key: 'videoStudio.pending.step', params: [3, 20] })
  })

  it('says what the engine does between steps', () => {
    expect(stageKey('fetch', false)).toBe('videoStudio.stage.fetch')
    expect(stageKey('decode', false)).toBe('videoStudio.stage.decode')
    expect(stageKey('decode', true)).toBe('videoStudio.stage.decodeFast')
    expect(stageKey('encode', false)).toBe('videoStudio.stage.encode')
    expect(stageKey('sampling', false)).toBe('videoStudio.stage.sampling')
    expect(stageKey(null, false)).toBe('thread.status.preparing')
    expect(stageKey(undefined, false)).toBe('thread.status.preparing')
  })
})

describe('videoStatus', () => {
  const context = { now: 1000, queueIndex: -1, modelInstalled: true, caps: { resolutions: [{ id: '480p', label: '480p', short_side: 480, long_side: 832 }] } }

  it('shows the position of a waiting message from the second one', () => {
    expect(videoStatus(message({ status: 'queued' }), undefined, { ...context, queueIndex: 0 })).toEqual({ kind: 'queued', position: null })
    expect(videoStatus(message({ status: 'queued' }), undefined, { ...context, queueIndex: 2 })).toEqual({ kind: 'queued', position: 3 })
  })

  it('counts the time spent loading the model and offers the download when it is missing', () => {
    expect(videoStatus(message({ status: 'loading' }), { message_id: 'm', load_started_at: 940 }, context)).toEqual({ kind: 'loading', elapsed: 60, downloadable: false })
    expect(videoStatus(message({ status: 'loading', started_at: 900 }), undefined, { ...context, modelInstalled: false })).toEqual({ kind: 'loading', elapsed: 100, downloadable: true })
  })

  it('reports the step, the clip of several, the remaining time and the stage', () => {
    const running = message({ status: 'running', params: { count: 2, fast_decode: true } })
    expect(videoStatus(running, { message_id: 'm', step: 4, total: 20, index: 1, eta: 90 }, context)).toEqual({ kind: 'running', step: 4, total: 20, stageKey: 'thread.status.preparing', clip: 2, eta: 90 })
    expect(videoStatus(running, { message_id: 'm', stage: 'decode', index: 0, eta: 90 }, context)).toMatchObject({ step: null, stageKey: 'videoStudio.stage.decodeFast', clip: 1, eta: null })
    expect(videoStatus(message({ status: 'running' }), undefined, context)).toMatchObject({ clip: null, stageKey: 'thread.status.preparing' })
  })

  it('summarizes a finished clip: size, duration, steps, time to generate', () => {
    const done = message({ params: { width: 832, height: 480, seconds: 5, steps: 40 }, started_at: 10, finished_at: 70 })
    expect(videoStatus(done, undefined, context)).toEqual({ kind: 'meta', size: '832×480', seconds: 5, steps: 40, duration: 60, createdAt: 1000 })
    expect(videoStatus(message({ params: { resolution: '480p' }, status: 'error', started_at: 10, finished_at: 70 }), undefined, context)).toMatchObject({ size: '480p', seconds: null, steps: null, duration: null })
  })
})

describe('stageKey and reusedVideo', () => {
  const start = asset('s', { media: 'image' })
  const end = asset('e', { media: 'image' })
  const video = asset('v')

  it('takes back the settings without what the engine derives, and pins the first seed', () => {
    const reused = reusedVideo(message({ params: { count: 2, seeds: [41, 42], seed: null, width: 832, height: 480, frames: 81, fps: 16, task: 'i2v', references_used: 1, seconds: 5.06, steps: 40, aspect: '16:9', resolution: '480p' } }), [])
    expect(reused).toMatchObject({ modelId: 'wan', prompt: 'un chat', count: 2, seed: 41, params: { seconds: 5.06, steps: 40, aspect: '16:9', resolution: '480p' } })
    expect(Object.keys(reused?.params ?? {}).sort()).toEqual(['aspect', 'resolution', 'seconds', 'steps'])
  })

  it('caps the clips at two and leaves the seed free when none was recorded', () => {
    expect(reusedVideo(message({ params: { count: 4 } }), [])).toMatchObject({ count: 2, seed: null })
    expect(reusedVideo(message({ params: {} }), [])?.count).toBeNull()
  })

  it('brings back the inputs of the prompt: images in order (start, end) and the video', () => {
    expect(reusedVideo(message(), [start, video, end])).toMatchObject({ start, end, source: video })
    expect(reusedVideo(message(), [video])).toMatchObject({ start: null, end: null, source: video })
    expect(reusedVideo(message({ references: [end] }), [start, video])).toMatchObject({ start: end, end: null, source: null })
  })

  it('has nothing to reuse without a model', () => {
    expect(reusedVideo(message({ model_id: null }), [])).toBeNull()
  })
})
