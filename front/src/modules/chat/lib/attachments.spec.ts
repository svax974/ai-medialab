/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { attachmentKind, checkAttachment, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, refusalKey } from './attachments'

const file = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('attachmentKind', () => {
  it('knows images, text and code, by type and by extension', () => {
    expect(attachmentKind(file('a.png', 'image/png'))).toBe('image')
    expect(attachmentKind(file('a.webp', 'image/webp'))).toBe('image')
    expect(attachmentKind(file('notes.txt', 'text/plain'))).toBe('text')
    expect(attachmentKind(file('main.rs', ''))).toBe('text')
    expect(attachmentKind(file('data.JSON', 'application/json'))).toBe('text')
  })

  it('refuses the rest', () => {
    expect(attachmentKind(file('a.svg', 'image/svg+xml'))).toBeNull()
    expect(attachmentKind(file('a.pdf', 'application/pdf'))).toBeNull()
    expect(attachmentKind(file('archive.zip', 'application/zip'))).toBeNull()
    expect(attachmentKind(file('noextension', ''))).toBeNull()
  })
})

describe('checkAttachment', () => {
  const ok = { vision: true, attached: 0 }

  it('accepts what fits', () => {
    expect(checkAttachment(file('a.png', 'image/png'), ok)).toEqual({ ok: true, kind: 'image' })
    expect(checkAttachment(file('a.md', 'text/markdown'), { vision: false, attached: 3 })).toEqual({ ok: true, kind: 'text' })
  })

  it('refuses an image for a model without vision, with the reason', () => {
    expect(checkAttachment(file('a.png', 'image/png'), { vision: false, attached: 0 })).toEqual({ ok: false, reason: 'noVision' })
  })

  it('refuses by size: 10 MB for an image, 1 MB for a text', () => {
    expect(checkAttachment(file('a.png', 'image/png', MAX_IMAGE_BYTES + 1), ok)).toEqual({ ok: false, reason: 'size' })
    expect(checkAttachment(file('a.txt', 'text/plain', MAX_TEXT_BYTES + 1), ok)).toEqual({ ok: false, reason: 'size' })
    expect(checkAttachment(file('a.txt', 'text/plain', MAX_TEXT_BYTES), ok).ok).toBe(true)
  })

  it('refuses by type and by count', () => {
    expect(checkAttachment(file('a.pdf', 'application/pdf'), ok)).toEqual({ ok: false, reason: 'type' })
    expect(checkAttachment(file('a.txt', 'text/plain'), { vision: true, attached: MAX_ATTACHMENTS })).toEqual({ ok: false, reason: 'tooMany' })
  })

  it('gives a locale key per refusal', () => {
    expect(refusalKey('noVision')).toBe('chat.attach.refused.noVision')
  })
})
