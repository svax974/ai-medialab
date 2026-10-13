/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest }))

import { messagesApi } from './messagesApi'

describe('messagesApi', () => {
  beforeEach(() => {
    studioRequest.mockClear()
  })

  it('creates, retries, cancels and deletes through /messages', async () => {
    const body = { conversation_id: null, prompt: 'p', model_id: 'm', params: {}, reference_ids: [], count: 1 }
    await messagesApi.send(body)
    await messagesApi.retry('m 1', { keep_seed: true })
    await messagesApi.retry('m1')
    await messagesApi.cancel('m1')
    await messagesApi.remove('m1')
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/messages', body],
      ['post', '/messages/m%201/retry', { keep_seed: true }],
      ['post', '/messages/m1/retry', {}],
      ['post', '/messages/m1/cancel'],
      ['delete', '/messages/m1'],
    ])
  })

  it('reads the generation queue (initial state of the browser)', async () => {
    await messagesApi.queue()
    expect(studioRequest.mock.calls).toEqual([['get', '/queue']])
  })
})
