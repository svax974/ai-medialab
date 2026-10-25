/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareTargets } from './share'

describe('share targets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers iMessage on Apple systems only', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    expect(shareTargets().map((entry) => entry.id)).toEqual(['mail', 'whatsapp', 'messages', 'x', 'facebook', 'instagram'])
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' })
    expect(shareTargets().map((entry) => entry.id)).toEqual(['mail', 'whatsapp', 'x', 'facebook', 'instagram'])
  })
})
