/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { usePromptHandoffStore } from './promptHandoffStore'

describe('promptHandoffStore', () => {
  beforeEach(() => usePromptHandoffStore.setState({ pending: null }))

  it('gives a text to the studio it was sent to, once', () => {
    usePromptHandoffStore.getState().send('video', 'un chien qui court')
    expect(usePromptHandoffStore.getState().take('image')).toBeNull()
    expect(usePromptHandoffStore.getState().take('video')).toBe('un chien qui court')
    expect(usePromptHandoffStore.getState().take('video')).toBeNull()
  })

  it('keeps one text only: a new one replaces the one waiting', () => {
    usePromptHandoffStore.getState().send('image', 'a')
    usePromptHandoffStore.getState().send('audio', 'b')
    expect(usePromptHandoffStore.getState().take('image')).toBeNull()
    expect(usePromptHandoffStore.getState().take('audio')).toBe('b')
  })
})
