/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useVoiceStudioStore } from './voiceStudioStore'

describe('voice studio store', () => {
  beforeEach(() => useVoiceStudioStore.getState().close())

  it('is closed at first, opens empty for a new voice, on a file, or on a voice to edit, and closes', () => {
    expect(useVoiceStudioStore.getState().target).toBeNull()
    useVoiceStudioStore.getState().open()
    expect(useVoiceStudioStore.getState().target).toEqual({})
    const file = new File(['x'], 'a.wav')
    useVoiceStudioStore.getState().open({ file })
    expect(useVoiceStudioStore.getState().target?.file).toBe(file)
    useVoiceStudioStore.getState().open({ voiceId: 'v1' })
    expect(useVoiceStudioStore.getState().target).toEqual({ voiceId: 'v1' })
    useVoiceStudioStore.getState().close()
    expect(useVoiceStudioStore.getState().target).toBeNull()
  })
})
