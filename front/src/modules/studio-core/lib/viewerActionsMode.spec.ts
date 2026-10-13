/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { viewerActionsMode } from './viewerActionsMode'

describe('viewerActionsMode', () => {
  it('gives a clip to the video studio whatever mode is on screen', () => {
    expect(viewerActionsMode({ media: 'video' }, 'image')).toBe('video')
    expect(viewerActionsMode({ media: 'video' }, 'audio')).toBe('video')
  })

  it('gives anything else to the mode on screen', () => {
    expect(viewerActionsMode({ media: 'image' }, 'video')).toBe('video')
    expect(viewerActionsMode({ media: 'image' }, 'image')).toBe('image')
    expect(viewerActionsMode({ media: 'audio' }, 'audio')).toBe('audio')
  })
})
