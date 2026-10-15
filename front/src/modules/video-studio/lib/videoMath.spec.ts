/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { VideoCaps } from '@/modules/model-catalog'
import { durationLimitKey, effectiveVideoParams, frameCount, runCount, videoSize } from './videoMath'

const caps: VideoCaps = {
  tasks: ['t2v'], fps: 24, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [{ id: '512p', label: '512p', short_side: 512, long_side: 768 }, { id: '720p', label: '720p', short_side: 704, long_side: 1280 }],
  default_resolution: '512p', image_input: 'none', last_frame: false, image_role: 'start', video_input: 'none', audio_out: false, english_only: false, license_warning: '',
}
const model = { params: [{ key: 'steps', default: 30 }, { key: 'guidance', default: 5 }], video: caps } as never

describe('frameCount', () => {
  it('is n * step + 1, at least one step', () => {
    expect(frameCount(5, caps)).toBe(121)
    expect(frameCount(2, { fps: 16, frame_step: 4 })).toBe(33)
    expect(frameCount(0.1, caps)).toBe(5)
    expect(frameCount(3, { fps: 24, frame_step: 0 })).toBe(72)
  })
})

describe('videoSize', () => {
  it('keeps the area of the native size at the requested format, snapped to 16', () => {
    expect(videoSize('16:9', caps.resolutions[0])).toEqual({ width: 832, height: 464 })
    expect(videoSize('9:16', caps.resolutions[0])).toEqual({ width: 464, height: 832 })
    expect(videoSize('1:1', caps.resolutions[0])).toEqual({ width: 624, height: 624 })
  })

  it('falls back to 16:9 for an unknown format and to nothing without a definition', () => {
    expect(videoSize('auto', caps.resolutions[0])).toEqual(videoSize('16:9', caps.resolutions[0]))
    expect(videoSize('16:9', undefined)).toBeNull()
  })
})

describe('effectiveVideoParams', () => {
  it('starts from the model defaults, then the video defaults', () => {
    expect(effectiveVideoParams(model, undefined)).toEqual({ steps: 30, guidance: 5, aspect: '16:9', resolution: '512p', seconds: 5 })
  })

  it('lets the saved choices win and clamps the duration to the model', () => {
    expect(effectiveVideoParams(model, { seconds: 99, steps: 10, aspect: '9:16', resolution: '720p' })).toMatchObject({ seconds: 5, steps: 10, aspect: '9:16', resolution: '720p' })
    expect(effectiveVideoParams(model, { seconds: 0.2 }).seconds).toBe(1)
    expect(effectiveVideoParams(model, { seconds: Number.NaN }).seconds).toBe(5)
  })

  it('drops a definition or a format the model does not offer', () => {
    expect(effectiveVideoParams(model, { resolution: '4k', aspect: 'custom' })).toMatchObject({ resolution: '512p', aspect: '16:9' })
  })
})

describe('runCount and durationLimitKey', () => {
  const chained = { fps: 24, frame_step: 4, segment_seconds: 1 }
  it('is one run for a model that does not chain, whatever the length', () => {
    expect(runCount(8, { fps: 24, frame_step: 4, segment_seconds: null })).toBe(1)
    expect(runCount(8, { fps: 24, frame_step: 4 })).toBe(1)
  })
  it('counts the chained runs, a run adding all of its frames but the first', () => {
    expect(runCount(1, chained)).toBe(1)
    expect(runCount(2, chained)).toBe(2)
    expect(runCount(20, chained)).toBe(20)
  })
  it('explains the limit by the chaining when the model chains, by the model otherwise', () => {
    expect(durationLimitKey({ segment_seconds: 3 })).toBe('videoStudio.duration.limit.chain')
    expect(durationLimitKey({ segment_seconds: null })).toBe('videoStudio.duration.limit.model')
  })
})
