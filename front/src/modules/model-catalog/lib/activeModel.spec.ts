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

describe('chat models (kind llm)', () => {
  const chat = (over: Partial<ModelCatalog> = {}) =>
    catalog({ models: [m('l1', 'llm'), m('l2', 'llm'), m('i1', 'image')], llm: { default_model_id: 'l2', recommended_model_id: 'l1', ready: false }, ...over })
  it('uses the engine default of the llm summary, then the first chat model', () => {
    expect(resolveActiveModel(chat(), 'llm', null)?.id).toBe('l2')
    expect(resolveActiveModel(chat({ llm: undefined }), 'llm', null)?.id).toBe('l1')
    expect(resolveActiveModel(chat(), 'llm', 'l1')?.id).toBe('l1')
  })
  it('never mixes the kinds', () => {
    expect(resolveActiveModel(chat(), 'image', null)?.id).toBe('i1')
  })
  it('proposes the recommended chat model while none is ready', () => {
    const c = chat()
    expect(welcomeModel(c, 'llm', c.models[0])?.id).toBe('l1')
    expect(welcomeModel(chat({ llm: { default_model_id: 'l2', recommended_model_id: 'l1', ready: true } }), 'llm', c.models[0])).toBeNull()
    expect(welcomeModel(chat({ llm: undefined }), 'llm', c.models[0])).toBeNull()
  })
})

describe('diagram models (kind diagram, nested like llm)', () => {
  const withDiagrams = (over: Partial<ModelCatalog> = {}) =>
    catalog({ models: [m('d1', 'diagram'), m('d2', 'diagram'), m('i1', 'image')], diagram: { default_model_id: 'd2', recommended_model_id: 'd1', ready: false }, ...over })
  it('uses the diagram summary default, then the first diagram model, never mixing kinds', () => {
    expect(resolveActiveModel(withDiagrams(), 'diagram', null)?.id).toBe('d2')
    expect(resolveActiveModel(withDiagrams({ diagram: undefined }), 'diagram', null)?.id).toBe('d1')
    expect(resolveActiveModel(withDiagrams(), 'image', null)?.id).toBe('i1')
  })
  it('proposes the recommended diagram model while none is ready', () => {
    const c = withDiagrams()
    expect(welcomeModel(c, 'diagram', c.models[0])?.id).toBe('d1')
    expect(welcomeModel(withDiagrams({ diagram: { default_model_id: 'd2', recommended_model_id: 'd1', ready: true } }), 'diagram', c.models[0])).toBeNull()
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
