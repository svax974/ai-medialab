/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { modelKindOfMode } from './modelKind'

describe('modelKindOfMode', () => {
  it('maps the chat to the language models and keeps the other modes', () => {
    expect(modelKindOfMode('chat')).toBe('llm')
    expect(modelKindOfMode('image')).toBe('image')
    expect(modelKindOfMode('audio')).toBe('audio')
    expect(modelKindOfMode('video')).toBe('video')
  })
})
