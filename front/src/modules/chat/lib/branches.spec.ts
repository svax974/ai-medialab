/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { branchPosition, comparisonSet, lastMessageId, missingSiblings } from './branches'
import { message } from './fixtures'

describe('branchPosition', () => {
  it('is null for a message without siblings', () => {
    expect(branchPosition(message('a'))).toBeNull()
  })

  it('gives the 1-based position and the neighbours', () => {
    const m = message('b', { sibling_ids: ['a', 'b', 'c'], sibling_index: 1 })
    expect(branchPosition(m)).toEqual({ index: 2, total: 3, previousId: 'a', nextId: 'c' })
    expect(branchPosition({ sibling_ids: ['a', 'b'], sibling_index: 0 })).toMatchObject({ previousId: null, nextId: 'b' })
    expect(branchPosition({ sibling_ids: ['a', 'b'], sibling_index: 1 })).toMatchObject({ previousId: 'a', nextId: null })
  })

  it('keeps an out-of-range index inside the list', () => {
    expect(branchPosition({ sibling_ids: ['a', 'b'], sibling_index: 9 })).toMatchObject({ index: 2 })
  })
})

describe('comparisonSet', () => {
  const answer = (id: string, model: string, extra = {}) => message(id, { role: 'assistant', model_id: model, sibling_ids: ['a1', 'a2', 'a3'], ...extra })
  const seen = (...ms: ReturnType<typeof answer>[]) => new Map(ms.map((m) => [m.id, m]))

  it('lists the siblings seen, oldest first, when two models answered', () => {
    const group = comparisonSet(answer('a2', 'gemma'), seen(answer('a1', 'qwen')))
    expect(group?.map((m) => m.id)).toEqual(['a1', 'a2'])
  })

  it('is null when every sibling comes from the same model, or only one is known, or the message is not an answer', () => {
    expect(comparisonSet(answer('a2', 'qwen'), seen(answer('a1', 'qwen')))).toBeNull()
    expect(comparisonSet(answer('a2', 'gemma'), seen())).toBeNull()
    expect(comparisonSet(message('u', { sibling_ids: ['u', 'v'] }), seen())).toBeNull()
  })

  it('leaves out an answer still being written', () => {
    expect(comparisonSet(answer('a2', 'gemma'), seen(answer('a1', 'qwen', { status: 'streaming' })))).toBeNull()
  })
})

describe('lastMessageId', () => {
  it('is the last message, or null', () => {
    expect(lastMessageId([message('a'), message('b')])).toBe('b')
    expect(lastMessageId([])).toBeNull()
  })
})

describe('missingSiblings', () => {
  const a = message('a2', { role: 'assistant', sibling_ids: ['a1', 'a2'], sibling_index: 1 })

  it('is true for an answer whose siblings this browser has not seen', () => {
    expect(missingSiblings(a, new Map())).toBe(true)
    expect(missingSiblings(a, new Map([['a1', message('a1')]]))).toBe(false)
  })

  it('is false for a lone answer, a user message and an answer still being written', () => {
    expect(missingSiblings(message('a', { role: 'assistant' }), new Map())).toBe(false)
    expect(missingSiblings({ ...a, role: 'user' }, new Map())).toBe(false)
    expect(missingSiblings({ ...a, status: 'streaming' }, new Map())).toBe(false)
  })
})
