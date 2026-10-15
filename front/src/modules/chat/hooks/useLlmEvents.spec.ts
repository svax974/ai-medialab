/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { LLM_STATUS_TOPIC, parseLlmStatus } from './useLlmEvents'

describe('parseLlmStatus', () => {
  it('reads the state the engine reports', () => {
    expect(parseLlmStatus({ state: 'ready', model_id: 'qwen', variant: 'Q4_K_M', context_size: 16384, vision: false, pid: 1, started_at: 5, last_error: null })).toEqual({
      state: 'ready',
      model_id: 'qwen',
      variant: 'Q4_K_M',
      context_size: 16384,
      vision: false,
      started_at: 5,
      last_error: null,
    })
  })

  it('fills what an idle engine leaves out', () => {
    expect(parseLlmStatus({ state: 'idle' })).toMatchObject({ state: 'idle', model_id: null, context_size: null })
  })

  it('ignores a payload that is not a state', () => {
    expect(parseLlmStatus({ state: 'weird' })).toBeNull()
    expect(parseLlmStatus(null)).toBeNull()
    expect(parseLlmStatus('ready')).toBeNull()
  })

  it('listens to the topic Nest relays', () => {
    expect(LLM_STATUS_TOPIC).toBe('engine.llm.status')
  })
})
