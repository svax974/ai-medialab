/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { resolveMediaUrl } from './studioHttp'

describe('resolveMediaUrl', () => {
  it('routes engine media through the /api/media prefix', () => {
    expect(resolveMediaUrl('/media/thumbs/a.webp', '/api')).toBe('/api/media/thumbs/a.webp')
  })
  it('leaves other URLs untouched', () => {
    expect(resolveMediaUrl('/api/media/x.png', '/api')).toBe('/api/media/x.png')
    expect(resolveMediaUrl('https://cdn.example/a.png', '/api')).toBe('https://cdn.example/a.png')
  })
})
