/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelCatalog, ModelInfo } from '../types'
import { resolveActiveModel, welcomeModel } from './activeModel'

const m = (id: string, kind: ModelInfo['kind'], task?: 'tts' | 'stt'): ModelInfo => ({ id, kind, audio: task ? ({ task } as ModelInfo['audio']) : null }) as ModelInfo
const catalog = (over: Partial<ModelCatalog> = {}): ModelCatalog => ({
  models: [m('i1', 'image'), m('i2', 'image'), m('a-stt', 'audio', 'stt'), m('a-tts', 'audio', 'tts'), m('v1', 'video')],
  default_model_id: 'i2',
  recommended_model_id: 'i1',
  ready: false,
  audio: { default_model_id: 'a-tts', recommended_model_id: 'a-tts', ready: true },
  video: { default_model_id: null, recommended_model_id: 'v1', ready: false },
  ...over,
})

describe('resolveActiveModel', () => {
  it('keeps the stored model when it still exists', () => {
    expect(resolveActiveModel(catalog(), 'image', 'i1')?.id).toBe('i1')
  })
  it('falls back to the server default, then to the first of the kind', () => {
    expect(resolveActiveModel(catalog(), 'image', 'gone')?.id).toBe('i2')
    expect(resolveActiveModel(catalog(), 'image', null)?.id).toBe('i2')
    expect(resolveActiveModel(catalog(), 'video', null)?.id).toBe('v1')
  })
  it('never offers a transcription model as generator', () => {
    expect(resolveActiveModel(catalog(), 'audio', 'a-stt')?.id).toBe('a-tts')
  })
  it('is undefined when the kind has no model', () => {
    expect(resolveActiveModel(catalog({ models: [] }), 'image', null)).toBeUndefined()
  })
})

describe('welcomeModel', () => {
  it('proposes the recommended model while nothing is ready', () => {
    const c = catalog()
    expect(welcomeModel(c, 'image', c.models[0])?.id).toBe('i1')
  })
  it('stays silent once a model is ready or when another model is active', () => {
    const c = catalog()
    expect(welcomeModel(c, 'audio', c.models[3])).toBeNull()
    expect(welcomeModel(c, 'image', c.models[1])).toBeNull()
    expect(welcomeModel(c, 'image', undefined)).toBeNull()
  })
})
