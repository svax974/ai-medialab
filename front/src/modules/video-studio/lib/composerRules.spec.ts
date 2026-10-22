/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo, VideoCaps } from '@/modules/model-catalog'
import type { Asset } from '@/modules/studio-core/types'
import { placeholderKey, slotRole, videoNotices, videoRequirements, videoSendState, visibleSlots, type VideoInputs } from './composerRules'

const caps = (extra: Partial<VideoCaps> = {}): VideoCaps => ({
  tasks: ['t2v'], fps: 24, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [], default_resolution: '480p',
  image_input: 'none', last_frame: false, image_role: 'start', video_input: 'none', audio_out: false, english_only: false, license_warning: '', ...extra,
})
const model = (video: Partial<VideoCaps>, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id: 'm', name: 'Wan', kind: 'video', video: caps(video), compatible: true, ready: true, engine_reason: null, plan: { note: '' }, ...extra }) as ModelInfo
const asset = (id: string, media: Asset['media'] = 'image') => ({ id, media }) as Asset
const none: VideoInputs = { start: null, end: null, source: null, uploading: 0 }

describe('videoRequirements', () => {
  it('asks for a start image when the model needs one and nothing replaces it', () => {
    const wan = model({ image_input: 'required' })
    expect(videoRequirements(wan, none).needStart).toBe(true)
    expect(videoRequirements(wan, { ...none, start: asset('a') }).needStart).toBe(false)
    expect(videoRequirements(model({ image_input: 'required', video_input: 'optional' }), { ...none, source: asset('v', 'video') }).needStart).toBe(false)
  })

  it('asks for a source video, and for the start image behind an end image', () => {
    expect(videoRequirements(model({ video_input: 'required' }), none).needSource).toBe(true)
    expect(videoRequirements(model({ last_frame: true, image_input: 'optional' }), { ...none, end: asset('e') }).endWithoutStart).toBe(true)
    expect(videoRequirements(model({ last_frame: true, image_input: 'optional' }), { ...none, start: asset('s'), end: asset('e') }).endWithoutStart).toBe(false)
  })

  it('is editing only with a source the model can use', () => {
    expect(videoRequirements(model({ video_input: 'optional' }), { ...none, source: asset('v', 'video') }).editing).toBe(true)
    expect(videoRequirements(model({ video_input: 'none' }), { ...none, source: asset('v', 'video') }).editing).toBe(false)
  })
})

describe('videoSendState', () => {
  const ready = model({})
  const sendable = { prompt: 'un chat', sending: false }

  it('sends a prompt for a ready model with nothing missing', () => {
    expect(videoSendState(ready, none, sendable)).toEqual({ canSend: true, block: null, tipKey: 'videoStudio.send.tip' })
  })

  it('needs a prompt and is closed while sending', () => {
    expect(videoSendState(ready, none, { prompt: '  ', sending: false }).canSend).toBe(false)
    expect(videoSendState(ready, none, { prompt: 'x', sending: true }).canSend).toBe(false)
  })

  it('says why not, in order: incompatible, not installed, source, start, import', () => {
    expect(videoSendState(model({}, { compatible: false, ready: false }), none, sendable)).toMatchObject({ canSend: false, tipKey: 'videoStudio.send.incompatible' })
    expect(videoSendState(model({}, { ready: false }), none, sendable).tipKey).toBe('videoStudio.send.notReady')
    expect(videoSendState(model({ video_input: 'required' }), none, sendable).tipKey).toBe('videoStudio.send.needSource')
    expect(videoSendState(model({ image_input: 'required' }), none, sendable).tipKey).toBe('videoStudio.send.needStart')
    expect(videoSendState(model({ last_frame: true, image_input: 'optional' }), { ...none, end: asset('e') }, sendable).tipKey).toBe('videoStudio.send.needStart')
    expect(videoSendState(ready, { ...none, uploading: 1 }, sendable)).toMatchObject({ canSend: false, block: 'uploading' })
  })
})

describe('videoNotices', () => {
  const ids = (m: ModelInfo, inputs: Partial<VideoInputs> = {}) => videoNotices(m, { ...none, ...inputs }).map((n) => n.id)

  it('explains why the model cannot run, with the engine text first, else the plan note', () => {
    expect(videoNotices(model({}, { compatible: false, engine_reason: 'Moteur absent' }), none)[0]).toMatchObject({ id: 'incompatible', tone: 'warn', text: 'Moteur absent' })
    expect(videoNotices(model({}, { plan: { note: 'Trop lourd', fits: false, strategy: 'none' } }), none)[0]).toMatchObject({ id: 'plan', tone: 'info', text: 'Trop lourd' })
  })

  it('names what is missing and what will be ignored', () => {
    expect(ids(model({ video_input: 'required' }))).toEqual(['needSource'])
    expect(ids(model({ image_input: 'required' }))).toEqual(['needStart'])
    expect(ids(model({}), { start: asset('s'), end: asset('e'), source: asset('v', 'video') })).toEqual(['startIgnored', 'endIgnored', 'sourceIgnored'])
    expect(ids(model({ last_frame: true, image_input: 'optional' }), { end: asset('e') })).toEqual(['endWithoutStart'])
  })

  it('tells about English prompts and the soundtrack, with their explanation', () => {
    const notices = videoNotices(model({ english_only: true, audio_out: true }), none)
    expect(notices.map((n) => n.id)).toEqual(['english', 'audio'])
    expect(notices.every((n) => n.tone === 'info' && n.help?.titleId)).toBe(true)
  })
})

describe('placeholderKey / visibleSlots / slotRole', () => {
  it('describes an edit, a movement or a scene', () => {
    expect(placeholderKey(true, true)).toBe('videoStudio.prompt.placeholder.edit')
    expect(placeholderKey(false, true)).toBe('videoStudio.prompt.placeholder.start')
    expect(placeholderKey(false, false)).toBe('videoStudio.prompt.placeholder.text')
  })

  it('shows the slots the model can use and those that still hold something', () => {
    expect(visibleSlots(model({}), none, [])).toEqual({ start: false, end: false, source: false })
    expect(visibleSlots(model({ image_input: 'optional', last_frame: true, video_input: 'optional' }), none, [])).toEqual({ start: true, end: true, source: true })
    expect(visibleSlots(model({}), { ...none, start: asset('s') }, ['source'])).toEqual({ start: true, end: false, source: true })
  })

  it('names each slot, whether it is required and whether the model ignores it', () => {
    expect(slotRole('start', model({ image_input: 'required' }), false)).toMatchObject({ labelKey: 'videoStudio.slot.start.label', required: true, unused: false })
    expect(slotRole('start', model({ image_input: 'required' }), true).required).toBe(false)
    expect(slotRole('start', model({ image_input: 'optional', image_role: 'reference' }), false)).toMatchObject({ labelKey: 'videoStudio.slot.reference.label', shortKey: 'videoStudio.slot.reference.short' })
    expect(slotRole('end', model({}), false)).toMatchObject({ required: false, unused: true })
    expect(slotRole('source', model({ video_input: 'required' }), false)).toMatchObject({ required: true, unused: false })
  })
})
