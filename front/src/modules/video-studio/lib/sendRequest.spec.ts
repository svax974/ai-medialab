/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo, VideoCaps } from '@/modules/model-catalog'
import type { Asset } from '@/modules/studio-core/types'
import { buildVideoRequest } from './sendRequest'

const caps = (extra: Partial<VideoCaps> = {}): VideoCaps => ({
  tasks: ['t2v'], fps: 24, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [], default_resolution: '480p',
  image_input: 'optional', last_frame: true, image_role: 'start', video_input: 'optional', audio_out: false, english_only: false, license_warning: '', ...extra,
})
const params = [{ key: 'steps', requires_references: false }, { key: 'strength', requires_references: true }]
const model = (video: Partial<VideoCaps> = {}) => ({ id: 'wan', video: caps(video), params }) as unknown as Pick<ModelInfo, 'id' | 'video' | 'params'>
const asset = (id: string, media: Asset['media'] = 'image') => ({ id, media }) as Asset
const base = { conversationId: 'c1', prompt: '  un chat  ', params: { steps: 30, strength: 0.7, seconds: 3 }, seed: null, count: 1 }

describe('buildVideoRequest', () => {
  it('sends the prompt, the model, the parameters and the seed', () => {
    expect(buildVideoRequest({ ...base, model: model(), inputs: { start: null, end: null, source: null } })).toEqual({
      conversation_id: 'c1', prompt: 'un chat', model_id: 'wan', params: { steps: 30, seconds: 3, seed: null }, reference_ids: [], count: 1,
    })
    expect(buildVideoRequest({ ...base, conversationId: null, seed: 12, model: model(), inputs: { start: null, end: null, source: null } })).toMatchObject({ conversation_id: null, params: { seed: 12 } })
  })

  it('lists the references in the engine order: start, end, source', () => {
    const request = buildVideoRequest({ ...base, model: model(), inputs: { start: asset('s'), end: asset('e'), source: asset('v', 'video') } })
    expect(request.reference_ids).toEqual(['s', 'e', 'v'])
  })

  it('leaves out what the model cannot use, and an end image without a start', () => {
    const inputs = { start: asset('s'), end: asset('e'), source: asset('v', 'video') }
    expect(buildVideoRequest({ ...base, model: model({ image_input: 'none', last_frame: false, video_input: 'none' }), inputs }).reference_ids).toEqual([])
    expect(buildVideoRequest({ ...base, model: model({ last_frame: false }), inputs }).reference_ids).toEqual(['s', 'v'])
    expect(buildVideoRequest({ ...base, model: model(), inputs: { start: null, end: asset('e'), source: null } }).reference_ids).toEqual([])
  })

  it('keeps the strength only when editing a video', () => {
    expect(buildVideoRequest({ ...base, model: model(), inputs: { start: null, end: null, source: asset('v', 'video') } }).params).toHaveProperty('strength', 0.7)
    expect(buildVideoRequest({ ...base, model: model(), inputs: { start: asset('s'), end: null, source: null } }).params).not.toHaveProperty('strength')
    expect(buildVideoRequest({ ...base, model: model({ video_input: 'none' }), inputs: { start: null, end: null, source: asset('v', 'video') } }).params).not.toHaveProperty('strength')
  })

  it('asks for two clips at most', () => {
    expect(buildVideoRequest({ ...base, count: 4, model: model(), inputs: { start: null, end: null, source: null } }).count).toBe(2)
  })

  it('does not change the parameters it was given', () => {
    const given = { steps: 30, strength: 0.7 }
    buildVideoRequest({ ...base, params: given, seed: 1, model: model(), inputs: { start: null, end: null, source: null } })
    expect(given).toEqual({ steps: 30, strength: 0.7 })
  })
})
