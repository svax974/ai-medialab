/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import type { LlmStatus } from '../types'
import { CONTEXT_MIN, contextChangeReloads, contextUsage, loadingLabel, requestedContext } from './context'
import { message } from './fixtures'

const model = (extra: Partial<NonNullable<ModelInfo['llm']>> = {}) => ({ llm: { context_default: 16384, context_max: 32768, vision: false, tools: true, reasoning: 'none', moe: false, params_b: 8, active_params_b: null, ...extra } }) as Pick<ModelInfo, 'llm'>
const loaded = (context: number | null, modelId = 'qwen', state: LlmStatus['state'] = 'ready'): LlmStatus => ({ state, model_id: modelId, context_size: context })

describe('contextUsage', () => {
  it('counts the tokens of the last answer exactly, plus the draft', () => {
    const answer = message('a', { role: 'assistant', stats: { prompt_tokens: 1000, completion_tokens: 200, tokens_per_second: 40, context_size: 16384, elapsed_ms: 5000 } })
    const usage = contextUsage([message('u', { content: 'x'.repeat(4000) }), answer], 16384, 50)
    expect(usage).toMatchObject({ used: 1250, limit: 16384, level: 'ok' })
  })

  it('estimates from the text when no answer has counted yet', () => {
    const usage = contextUsage([message('u', { content: 'a'.repeat(3600) })], 4000)
    expect(usage?.used).toBe(1000)
  })

  it('warns from 75 % and from 90 %', () => {
    const at = (used: number) => contextUsage([message('a', { role: 'assistant', stats: { prompt_tokens: used, completion_tokens: 0, tokens_per_second: null, context_size: 1000, elapsed_ms: 1 } })], 1000)?.level
    expect([at(700), at(750), at(899), at(900), at(1300)]).toEqual(['ok', 'warn', 'warn', 'full', 'full'])
  })

  it('is null while the size of the context is unknown', () => {
    expect(contextUsage([], null)).toBeNull()
    expect(contextUsage([], 0)).toBeNull()
  })
})

describe('requestedContext', () => {
  it('is the conversation\'s own setting, else the model\'s default', () => {
    expect(requestedContext({ context_size: 8192 }, model())).toBe(8192)
    expect(requestedContext({ context_size: null }, model())).toBe(16384)
  })

  it('is bounded by what the model supports and by the engine\'s minimum, like the engine does', () => {
    expect(requestedContext({ context_size: 1_000_000 }, model())).toBe(32768)
    expect(requestedContext({ context_size: 10 }, model())).toBe(CONTEXT_MIN)
  })

  it('is unknown without a model and without a setting', () => {
    expect(requestedContext({ context_size: null }, undefined)).toBeNull()
  })
})

describe('contextChangeReloads: does the context asked for differ from the loaded one?', () => {
  it('is true when the loaded model of the chat has another context', () => {
    expect(contextChangeReloads(32768, loaded(16384), 'qwen')).toBe(true)
    expect(contextChangeReloads(32768, loaded(16384, 'qwen', 'generating'), 'qwen')).toBe(true)
  })

  it('is false when it is the same context', () => {
    expect(contextChangeReloads(16384, loaded(16384), 'qwen')).toBe(false)
  })

  it('is false when no model is loaded (it will load anyway)', () => {
    expect(contextChangeReloads(32768, loaded(null, 'qwen', 'idle'), 'qwen')).toBe(false)
    expect(contextChangeReloads(32768, loaded(16384, 'qwen', 'loading'), 'qwen')).toBe(false)
    expect(contextChangeReloads(32768, null, 'qwen')).toBe(false)
  })

  it('is false for another model than the loaded one (it reloads anyway) and for an unknown request', () => {
    expect(contextChangeReloads(32768, loaded(16384, 'gemma'), 'qwen')).toBe(false)
    expect(contextChangeReloads(null, loaded(16384), 'qwen')).toBe(false)
    expect(contextChangeReloads(32768, loaded(16384), null)).toBe(false)
  })
})

describe('loadingLabel', () => {
  it('says the model reloads with the new context size', () => {
    expect(loadingLabel(32768, loaded(16384), 'qwen')).toEqual({ key: 'chat.status.reloadContext', params: [32768] })
  })

  it('says a plain load otherwise', () => {
    expect(loadingLabel(16384, loaded(16384), 'qwen')).toEqual({ key: 'chat.status.loadingModel', params: [] })
    expect(loadingLabel(16384, null, 'qwen')).toEqual({ key: 'chat.status.loadingModel', params: [] })
  })
})
