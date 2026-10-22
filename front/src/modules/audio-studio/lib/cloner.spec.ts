/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { cloningModels, modelForVoice, speaksLanguage } from './cloner'

const model = (id: string, extra: Partial<ModelInfo> = {}, audio: Record<string, unknown> = {}): ModelInfo =>
  ({ id, kind: 'audio', ready: true, compatible: true, download_size_gb: 1, audio: { task: 'tts', clone: 'optional', languages: [{ code: 'fr', label: 'Français' }], ...audio }, ...extra }) as unknown as ModelInfo

describe('cloning models', () => {
  const models = [model('kokoro', {}, { clone: 'none' }), model('big', { ready: false, download_size_gb: 4 }), model('small', { ready: false, download_size_gb: 1 }), model('ready', { download_size_gb: 9 }), model('gpu', { compatible: false }), model('whisper', {}, { task: 'stt' }), { id: 'img', kind: 'image', audio: null } as unknown as ModelInfo]

  it('keeps the compatible models that clone, ready ones first then the lightest download', () => {
    expect(cloningModels(models).map((m) => m.id)).toEqual(['ready', 'small', 'big'])
  })

  it('writes with the active model when it can clone, else with the best cloning one, else with none', () => {
    expect(modelForVoice(models, models[3])?.id).toBe('ready')
    expect(modelForVoice(models, models[0])?.id).toBe('ready')
    expect(modelForVoice(models, undefined)?.id).toBe('ready')
    expect(modelForVoice([models[0], models[4]], models[0])).toBeUndefined()
  })

  it('knows whether the model speaks the language of a voice', () => {
    expect(speaksLanguage(model('m'), 'fr')).toBe(true)
    expect(speaksLanguage(model('m'), 'ja')).toBe(false)
    expect(speaksLanguage(model('m'), null)).toBe(false)
  })
})
