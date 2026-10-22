/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { message } from './fixtures'
import { concernsGeneration, generationMessageIds } from './generationEvents'

const withJobs = (...ids: (string | null)[]) => message('m', { generations: ids.map((message_id, i) => ({ id: `g${i}`, kind: 'image', model_id: 'flux', message_id, prompt: 'x', params: {}, state: 'queued', error: null, assets: [], conversation_id: 'c1' })) as never })

describe('generationMessageIds', () => {
  it('collects the jobs of every message, leaving out what waits for a choice', () => {
    expect([...generationMessageIds([withJobs('j1', null), withJobs('j2'), message('plain')])]).toEqual(['j1', 'j2'])
  })
})

describe('concernsGeneration', () => {
  const ids = new Set(['j1'])
  it('recognises the events of a watched job', () => {
    expect(concernsGeneration({ topic: 'studio.message.updated', data: { id: 'j1' } }, ids)).toBe(true)
    expect(concernsGeneration({ topic: 'studio.job.image', data: { message_id: 'j1' } }, ids)).toBe(true)
    expect(concernsGeneration({ topic: 'studio.message.deleted', data: { ids: ['x', 'j1'] } }, ids)).toBe(true)
  })

  it('ignores the others', () => {
    expect(concernsGeneration({ topic: 'studio.message.updated', data: { id: 'j2' } }, ids)).toBe(false)
    expect(concernsGeneration({ topic: 'studio.job.image', data: {} }, ids)).toBe(false)
    expect(concernsGeneration({ topic: 'studio.queue.updated', data: { id: 'j1' } }, ids)).toBe(false)
    expect(concernsGeneration({ topic: 'studio.message.updated' }, ids)).toBe(false)
  })
})
