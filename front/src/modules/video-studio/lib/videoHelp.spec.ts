/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { VideoCaps } from '@/modules/model-catalog'
import { resolutionHelp, slotHelp, slotStatusKey, VIDEO_HELP } from './videoHelp'

const caps = (extra: Partial<VideoCaps> = {}): VideoCaps => ({
  tasks: ['t2v'], fps: 24, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [{ id: '480p', label: '480p', short_side: 480, long_side: 832 }, { id: '720p', label: '720p', short_side: 704, long_side: 1280 }],
  default_resolution: '480p', image_input: 'none', last_frame: false, image_role: 'start', video_input: 'none', audio_out: false, english_only: false, license_warning: '', ...extra,
})
const t = (key: string, params?: (string | number)[]) => `«${key}${params ? `|${params.join(',')}` : ''}»`

describe('slotStatusKey', () => {
  it('says what this model does with each slot', () => {
    expect(slotStatusKey('start', caps({ image_input: 'required' }))).toBe('videoStudio.help.slot.status.start.required')
    expect(slotStatusKey('start', caps())).toBe('videoStudio.help.slot.status.start.none')
    expect(slotStatusKey('end', caps({ last_frame: true }))).toBe('videoStudio.help.slot.status.end.optional')
    expect(slotStatusKey('end', caps())).toBe('videoStudio.help.slot.status.end.none')
    expect(slotStatusKey('source', caps({ video_input: 'optional' }))).toBe('videoStudio.help.slot.status.source.optional')
  })
})

describe('slotHelp', () => {
  it('titles the slot with its name and whether it is required, adds the model status to the explanation', () => {
    const help = slotHelp('start', caps({ image_input: 'required' }), 'Image de départ', true, t)
    expect(help.title).toBe('Image de départ «videoStudio.slot.titleRequired»')
    expect(help.body).toBe('«videoStudio.help.slot.start.body»\n\n«videoStudio.help.slot.status.start.required»')
    expect(help.tip).toBe('«videoStudio.slot.tip»')
  })

  it('adds the reference role to a start image that is only a reference, and the own tip of the source', () => {
    expect(slotHelp('start', caps({ image_input: 'optional', image_role: 'reference' }), 'Réf.', false, t).body).toContain('«videoStudio.help.slot.role.reference»')
    expect(slotHelp('source', caps({ video_input: 'optional' }), 'Vidéo source', false, t).tip).toBe('«videoStudio.help.slot.source.tip»')
  })
})

describe('resolutionHelp', () => {
  it('lists the definitions of the model after the generic text', () => {
    const help = resolutionHelp(caps(), t)
    expect(help.body).toBe('«videoStudio.help.resolution.body»\n\n«videoStudio.format.thisModel|480p ≈ 832×480 · 720p ≈ 1280×704»')
  })
})

describe('VIDEO_HELP', () => {
  it('points at locale keys', () => {
    expect(VIDEO_HELP.seconds).toEqual({ titleId: 'videoStudio.help.seconds.title', bodyId: 'videoStudio.help.seconds.body', tipId: 'videoStudio.help.seconds.tip' })
    expect(VIDEO_HELP.count).not.toHaveProperty('tipId')
  })
})
