/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { buildSendRequest } from './sendRequest'

describe('buildSendRequest', () => {
  it('trims the prompt, adds the seed to the parameters and lists the reference ids in order', () => {
    expect(buildSendRequest({ conversationId: 'c1', prompt: '  un chat  ', modelId: 'flux', params: { steps: 8, aspect: '1:1' }, seed: 5, references: [{ id: 'r1' }, { id: 'r2' }], count: 2 })).toEqual({
      conversation_id: 'c1',
      prompt: 'un chat',
      model_id: 'flux',
      params: { steps: 8, aspect: '1:1', seed: 5 },
      reference_ids: ['r1', 'r2'],
      count: 2,
    })
  })

  it('creates a conversation when there is none, with a random seed', () => {
    const request = buildSendRequest({ conversationId: null, prompt: 'x', modelId: 'm', params: {}, seed: null, references: [], count: 1 })
    expect(request.conversation_id).toBeNull()
    expect(request.params).toEqual({ seed: null })
    expect(request.reference_ids).toEqual([])
  })
})
