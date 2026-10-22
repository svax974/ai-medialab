/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { audioNotices, audioSendState, sendBlock } from './composerRules'

const model = (extra: Partial<ModelInfo> = {}, design = false): ModelInfo =>
  ({ id: 'tts', name: 'Kokoro', kind: 'audio', ready: true, compatible: true, engine_reason: null, plan: { fits: true, strategy: 'full', note: '' }, audio: { design } as ModelInfo['audio'], ...extra }) as ModelInfo
const input = { prompt: 'Bonjour', hasVoice: true, instruct: '', sending: false }

describe('what blocks the send button', () => {
  it('is nothing for a ready model with a text and a voice', () => {
    expect(audioSendState(model(), input)).toEqual({ canSend: true, block: null, tipKey: 'audioStudio.send.tip' })
  })

  it('names the first missing thing, in order: compatibility, installation, description or voice', () => {
    expect(sendBlock(model({ compatible: false, ready: false }), input)).toBe('incompatible')
    expect(sendBlock(model({ ready: false }), input)).toBe('notReady')
    expect(sendBlock(model({}, true), input)).toBe('needsDescription')
    expect(sendBlock(model({}, true), { ...input, instruct: ' une voix grave ' })).toBeNull()
    expect(sendBlock(model(), { ...input, hasVoice: false })).toBe('needsVoice')
    expect(sendBlock(model({}, true), { ...input, hasVoice: false, instruct: 'x' })).toBeNull()
  })

  it('refuses an empty text, a text over 8000 characters and a send in progress, with the usual tooltip', () => {
    expect(audioSendState(model(), { ...input, prompt: '   ' }).canSend).toBe(false)
    expect(audioSendState(model(), { ...input, prompt: 'x'.repeat(8001) }).canSend).toBe(false)
    expect(audioSendState(model(), { ...input, prompt: 'x'.repeat(8000) }).canSend).toBe(true)
    expect(audioSendState(model(), { ...input, sending: true }).canSend).toBe(false)
    expect(audioSendState(model({ ready: false }), input).tipKey).toBe('audioStudio.send.notReady')
    expect(audioSendState(model(), { ...input, hasVoice: false }).tipKey).toBe('audioStudio.send.needsVoice')
  })
})

describe('audioNotices', () => {
  it('says why a model cannot run (the engine\'s reason, else the plan\'s, else a generic line with its name)', () => {
    expect(audioNotices(model({ compatible: false, engine_reason: 'Pas de GPU' }), { prompt: '', needsVoice: false })).toEqual([{ id: 'incompatible', tone: 'warn', text: 'Pas de GPU', key: 'audioStudio.notice.incompatible', params: ['Kokoro'] }])
    expect(audioNotices(model({ compatible: false }), { prompt: '', needsVoice: false })[0]).toMatchObject({ text: undefined, key: 'audioStudio.notice.incompatible' })
  })

  it('shows the plan\'s note, a missing voice (only on a model that runs) and a very long text', () => {
    const notes = audioNotices(model({ plan: { fits: true, strategy: 'model_offload', note: 'Déchargé en partie.' } }), { prompt: 'x'.repeat(6001), needsVoice: true })
    expect(notes.map((n) => n.id)).toEqual(['plan', 'needsVoice', 'long'])
    expect(audioNotices(model({ compatible: false }), { prompt: '', needsVoice: true }).map((n) => n.id)).toEqual(['incompatible'])
    expect(audioNotices(model(), { prompt: 'x'.repeat(6000), needsVoice: false })).toEqual([])
  })
})
