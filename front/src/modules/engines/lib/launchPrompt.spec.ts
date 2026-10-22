/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { shouldPromptLocalAi, type LaunchPromptInput } from './launchPrompt'

const due: LaunchPromptInput = { state: 'needs-setup', engineInstalled: false, optOut: false, dismissed: false, privateMode: false }

describe('shouldPromptLocalAi', () => {
  it('is due at launch when the chat engine is missing', () => {
    expect(shouldPromptLocalAi(due)).toBe(true)
    expect(shouldPromptLocalAi({ ...due, state: 'no-space' })).toBe(true)
  })
  it('stays quiet once the user said not to offer it again, or dismissed it for this launch', () => {
    expect(shouldPromptLocalAi({ ...due, optOut: true })).toBe(false)
    expect(shouldPromptLocalAi({ ...due, dismissed: true })).toBe(false)
  })
  it('stays quiet while the machine or the catalogue is not read, during an install, after a failure and in a private session', () => {
    for (const state of ['unknown', 'installing', 'downloading', 'error', 'ready'] as const) expect(shouldPromptLocalAi({ ...due, state })).toBe(false)
    expect(shouldPromptLocalAi({ ...due, privateMode: true })).toBe(false)
  })
  it('does not ask for a model alone: with the engine installed the Chat page and the model list offer it', () => {
    expect(shouldPromptLocalAi({ ...due, engineInstalled: true })).toBe(false)
  })
})
