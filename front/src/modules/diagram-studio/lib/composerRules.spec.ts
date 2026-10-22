/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { sendState } from './composerRules'

const model = (over: Partial<ModelInfo> = {}): ModelInfo => ({ compatible: true, ready: true, ...over }) as ModelInfo

describe('sendState', () => {
  it('refuses an incompatible model first, even with a prompt', () => {
    expect(sendState(model({ compatible: false }), 'hello', false)).toEqual({ canSend: false, tipKey: 'diagramStudio.send.incompatible' })
  })
  it('refuses a model that is not (fully) downloaded', () => {
    expect(sendState(model({ ready: false }), 'hello', false)).toEqual({ canSend: false, tipKey: 'diagramStudio.send.notReady' })
  })
  it('refuses while a generation is already sending', () => {
    expect(sendState(model(), 'hello', true)).toEqual({ canSend: false, tipKey: 'diagramStudio.send.sending' })
  })
  it('refuses an empty or blank prompt', () => {
    expect(sendState(model(), '', false)).toEqual({ canSend: false, tipKey: 'diagramStudio.send.empty' })
    expect(sendState(model(), '   ', false)).toEqual({ canSend: false, tipKey: 'diagramStudio.send.empty' })
  })
  it('allows sending once everything is ready', () => {
    expect(sendState(model(), 'draw a flowchart', false)).toEqual({ canSend: true, tipKey: 'diagramStudio.send.tip' })
  })
})
