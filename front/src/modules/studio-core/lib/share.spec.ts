/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHARE_TARGETS, shareTargets } from './share'

const target = (id: string) => SHARE_TARGETS.find((entry) => entry.id === id)!

describe('share targets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes the text in each link', () => {
    expect(target('mail').href('a & b', 'Sujet é')).toBe('mailto:?subject=Sujet%20%C3%A9&body=a%20%26%20b')
    expect(target('whatsapp').href('a b', '')).toBe('https://wa.me/?text=a%20b')
    expect(target('x').href('a?b', '')).toBe('https://twitter.com/intent/tweet?text=a%3Fb')
  })

  it('offers iMessage on Apple systems only', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    expect(shareTargets().map((entry) => entry.id)).toContain('messages')
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' })
    expect(shareTargets().map((entry) => entry.id)).toEqual(['mail', 'whatsapp', 'x'])
  })
})
