/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { classifyDrop } from './dropRules'

const file = (name: string, type = '') => ({ name, type, size: 10 })

describe('classifyDrop', () => {
  it('audio keeps only the first sound file, by type or by extension', () => {
    const { accepted, warningKey } = classifyDrop('audio', [file('notes.txt', 'text/plain'), file('voice.m4a'), file('other.wav', 'audio/wav')])
    expect(accepted.map((f) => f.name)).toEqual(['voice.m4a'])
    expect(warningKey).toBeNull()
  })

  it('audio warns when nothing is a sound', () => {
    expect(classifyDrop('audio', [file('a.png', 'image/png')])).toEqual({ accepted: [], warningKey: 'library.drop.audio.ignored' })
  })

  it('video keeps every image and video', () => {
    const { accepted } = classifyDrop('video', [file('a.png', 'image/png'), file('b.mkv'), file('c.txt', 'text/plain'), file('d.heic')])
    expect(accepted.map((f) => f.name)).toEqual(['a.png', 'b.mkv', 'd.heic'])
  })

  it('video warns when nothing fits, and not for an empty drop', () => {
    expect(classifyDrop('video', [file('a.wav', 'audio/wav')]).warningKey).toBe('library.drop.video.ignored')
    expect(classifyDrop('video', []).warningKey).toBeNull()
  })
})
