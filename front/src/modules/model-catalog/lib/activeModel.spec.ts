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
  it('prefers the installed model used the most over the server default', () => {
    const c = catalog({ models: [{ ...m('i1', 'image'), ready: true }, { ...m('i2', 'image'), ready: true }, { ...m('i3', 'image'), ready: true }] as ModelInfo[] })
    expect(resolveActiveModel(c, 'image', null, { i1: 4, i3: 9 })?.id).toBe('i3')
    expect(resolveActiveModel(c, 'image', 'i1', { i3: 9 })?.id).toBe('i1')  // an explicit choice still wins
  })
  it('ignores a used model that is no longer installed, and falls back to the default when nothing was used', () => {
    const c = catalog({ models: [{ ...m('i1', 'image'), ready: true }, { ...m('i2', 'image'), ready: false }] as ModelInfo[] })
    expect(resolveActiveModel(c, 'image', null, { i2: 12, i1: 1 })?.id).toBe('i1')
    expect(resolveActiveModel(c, 'image', null, {})?.id).toBe('i2')
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
