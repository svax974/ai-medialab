/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo, VideoCaps } from '@/modules/model-catalog'
import { isImageFile, isVideoFile, modelSwitchFor, planImport, slotForAsset } from './slots'

const caps = (extra: Partial<VideoCaps> = {}): VideoCaps => ({
  tasks: ['t2v'], fps: 24, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [], default_resolution: '480p',
  image_input: 'none', last_frame: false, image_role: 'start', video_input: 'none', audio_out: false, english_only: false, license_warning: '', ...extra,
})
const model = (id: string, video: Partial<VideoCaps>, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, kind: 'video', video: caps(video), compatible: true, ready: true, download_size_gb: 5, ...extra }) as ModelInfo
const file = (name: string, type = '') => ({ name, type })

describe('file kinds', () => {
  it('recognizes videos and images by type or extension', () => {
    expect(isVideoFile(file('a.MOV'))).toBe(true)
    expect(isVideoFile(file('blob', 'video/webm'))).toBe(true)
    expect(isVideoFile(file('a.png'))).toBe(false)
    expect(isImageFile(file('a.HEIC'))).toBe(true)
    expect(isImageFile(file('blob', 'image/png'))).toBe(true)
    expect(isImageFile(file('a.pdf'))).toBe(false)
  })
})

describe('modelSwitchFor', () => {
  const t2v = model('t2v', {})
  const i2v = model('i2v', { image_input: 'optional' }, { download_size_gb: 20 })
  const light = model('light', { image_input: 'required' }, { download_size_gb: 6 })
  const notReadyLight = model('nr', { image_input: 'optional' }, { ready: false, download_size_gb: 1 })
  const broken = model('broken', { image_input: 'optional' }, { compatible: false })

  it('keeps the active model when it takes the input', () => {
    expect(modelSwitchFor('start', i2v, [t2v, i2v])).toBeNull()
    expect(modelSwitchFor('end', model('f', { last_frame: true }), [])).toBeNull()
  })

  it('picks a compatible model that does, ready ones first, then the lightest', () => {
    expect(modelSwitchFor('start', t2v, [t2v, i2v, light, notReadyLight, broken])?.id).toBe('light')
    expect(modelSwitchFor('start', t2v, [t2v, notReadyLight, broken])?.id).toBe('nr')
  })

  it('finds nothing when no model can, or when there is no active model', () => {
    expect(modelSwitchFor('source', t2v, [t2v, i2v])).toBeNull()
    expect(modelSwitchFor('start', undefined, [i2v])).toBeNull()
  })
})

describe('slotForAsset', () => {
  it('sends a video to the source, an image to the start then to the end when the model has one', () => {
    expect(slotForAsset({ media: 'video' }, { start: true, end: false }, caps())).toBe('source')
    expect(slotForAsset({ media: 'image' }, { start: false, end: false }, caps({ last_frame: true }))).toBe('start')
    expect(slotForAsset({ media: 'image' }, { start: true, end: false }, caps({ last_frame: true }))).toBe('end')
    expect(slotForAsset({ media: 'image' }, { start: true, end: false }, caps())).toBe('start')
    expect(slotForAsset({ media: 'image' }, { start: true, end: true }, caps({ last_frame: true }))).toBe('start')
  })
})

describe('planImport', () => {
  const free = { start: false, end: false }

  it('puts the first video in the source and the images in the start then the end', () => {
    const plan = planImport([file('a.mp4'), file('b.png'), file('c.jpg')], free, caps({ last_frame: true }))
    expect(plan.jobs.map((j) => [j.file.name, j.slot])).toEqual([['a.mp4', 'source'], ['b.png', 'start'], ['c.jpg', 'end']])
    expect(plan.warnings).toEqual([])
  })

  it('uses only the start without an end image on the model, and the end when the start is already taken', () => {
    expect(planImport([file('b.png'), file('c.png')], free, caps()).jobs.map((j) => j.slot)).toEqual(['start', 'start'])
    expect(planImport([file('c.png')], { start: true, end: false }, caps({ last_frame: true })).jobs.map((j) => j.slot)).toEqual(['end'])
    expect(planImport([file('c.png')], { start: true, end: false }, caps()).jobs.map((j) => j.slot)).toEqual(['start'])
  })

  it('obeys the slot a file was dropped on', () => {
    expect(planImport([file('b.png')], free, caps({ last_frame: true }), 'end').jobs[0].slot).toBe('end')
    expect(planImport([file('b.png')], { start: true, end: false }, caps({ last_frame: true }), 'start').jobs[0].slot).toBe('start')
    expect(planImport([file('b.png')], { start: true, end: false }, caps({ last_frame: true }), 'source').jobs[0].slot).toBe('end')
  })

  it('warns about what it leaves out: other types, a second video, a third image', () => {
    const plan = planImport([file('a.mp4'), file('b.mov'), file('x.pdf'), file('1.png'), file('2.png'), file('3.png')], free, caps({ last_frame: true }))
    expect(plan.warnings).toEqual(['ignoredSome', 'oneVideo', 'twoImages'])
    expect(plan.jobs).toHaveLength(3)
  })

  it('plans nothing, with the warning, when no file is usable', () => {
    expect(planImport([file('x.pdf')], free, caps())).toEqual({ jobs: [], warnings: ['ignoredSome'] })
  })
})
