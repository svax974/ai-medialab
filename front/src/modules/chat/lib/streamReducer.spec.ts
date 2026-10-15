/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { conversation, message } from './fixtures'
import { applyStreamEvent, isStreaming, placeMessage } from './streamReducer'

const u1 = message('u1', { content: 'Salut' })
const a1 = message('a1', { role: 'assistant', parent_id: 'u1', content: 'Bonjour', model_id: 'qwen' })
const thread = () => conversation([u1, a1], { leaf_id: 'a1' })

describe('placeMessage', () => {
  it('appends a new message after its parent and makes it the leaf', () => {
    const next = placeMessage(thread(), message('u2', { parent_id: 'a1', content: 'Et ensuite ?' }))
    expect(next.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    expect(next.settings.leaf_id).toBe('u2')
    expect(next.conversation.generation_count).toBe(3)
  })

  it('replaces a message it already has, in place', () => {
    const next = placeMessage(thread(), { ...a1, content: 'Bonjour !' })
    expect(next.messages).toHaveLength(2)
    expect(next.messages[1].content).toBe('Bonjour !')
  })

  it('starts a new branch for a sibling: what followed the old sibling leaves the thread', () => {
    const long = conversation([u1, a1, message('u2', { parent_id: 'a1' }), message('a2', { role: 'assistant', parent_id: 'u2' })])
    const regenerated = message('a1b', { role: 'assistant', parent_id: 'u1', sibling_ids: ['a1', 'a1b'], sibling_index: 1 })
    const next = placeMessage(long, regenerated)
    expect(next.messages.map((m) => m.id)).toEqual(['u1', 'a1b'])
  })

  it('starts a new root when the message has no parent', () => {
    const next = placeMessage(thread(), message('r2', { parent_id: null }))
    expect(next.messages.map((m) => m.id)).toEqual(['r2'])
  })
})

describe('applyStreamEvent', () => {
  const streaming = () => placeMessage(thread(), message('a2', { role: 'assistant', parent_id: 'a1', status: 'streaming' }))

  it('writes the text, the thinking and the tool runs into the right message', () => {
    let c = streaming()
    c = applyStreamEvent(c, { type: 'reasoning', id: 'a2', content: 'Hmm. ' })
    c = applyStreamEvent(c, { type: 'reasoning', id: 'a2', content: 'Voyons.' })
    c = applyStreamEvent(c, { type: 'delta', id: 'a2', content: 'Il ' })
    c = applyStreamEvent(c, { type: 'delta', id: 'a2', content: 'pleut.' })
    c = applyStreamEvent(c, { type: 'tool', id: 'a2', run: { id: 'r1', name: 'web_search', arguments: { query: 'météo' }, status: 'running' } })
    c = applyStreamEvent(c, { type: 'tool', id: 'a2', run: { id: 'r1', name: 'web_search', arguments: { query: 'météo' }, status: 'done', sources: [{ title: 't', url: 'https://x.org' }] } })
    const m = c.messages.find((x) => x.id === 'a2')
    expect(m).toMatchObject({ content: 'Il pleut.', reasoning: 'Hmm. Voyons.' })
    expect(m?.tool_runs).toHaveLength(1)
    expect(m?.tool_runs[0].status).toBe('done')
  })

  it('records the statistics and the final message', () => {
    let c = applyStreamEvent(streaming(), { type: 'usage', id: 'a2', stats: { prompt_tokens: 10, completion_tokens: 5, tokens_per_second: 30, context_size: 16384, elapsed_ms: 900 } })
    expect(c.messages[2].stats?.completion_tokens).toBe(5)
    c = applyStreamEvent(c, { type: 'done', message: message('a2', { role: 'assistant', parent_id: 'a1', content: 'Fini', status: 'done' }) })
    expect(c.messages[2]).toMatchObject({ content: 'Fini', status: 'done' })
    expect(isStreaming(c)).toBe(false)
  })

  it('marks the message of an error, and leaves the thread alone for an error without message', () => {
    const failed = applyStreamEvent(streaming(), { type: 'error', code: 'upstream', message: 'boum', id: 'a2' })
    expect(failed.messages[2]).toMatchObject({ status: 'error', error: 'boum' })
    const c = streaming()
    expect(applyStreamEvent(c, { type: 'error', code: 'busy', message: 'occupé' })).toBe(c)
  })

  it('updates the title, and ignores events for messages it does not have', () => {
    const c = streaming()
    expect(applyStreamEvent(c, { type: 'title', title: 'Météo' }).conversation.title).toBe('Météo')
    expect(applyStreamEvent(c, { type: 'delta', id: 'ghost', content: 'x' })).toBe(c)
    expect(applyStreamEvent(c, { type: 'loading', phase: 'loading', model_id: 'q' })).toBe(c)
  })

  it('tells that an answer is being written', () => {
    expect(isStreaming(streaming())).toBe(true)
    expect(isStreaming(thread())).toBe(false)
  })
})
