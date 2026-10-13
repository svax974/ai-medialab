/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async () => ({})))
const studioUpload = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest, studioUpload }))

import { assetsApi } from './assetsApi'
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
})

describe('assetsApi', () => {
  beforeEach(() => {
    studioRequest.mockClear()
    studioUpload.mockClear()
  })

  it('lists the generated images, newest first, with the gallery filters', async () => {
    await assetsApi.list()
    await assetsApi.list({ media: 'video', favorites: true, q: 'chat noir', before: 12, limit: 10 })
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/assets?kind=generated&limit=60&media=image'],
      ['get', '/assets?kind=generated&limit=10&media=video&favorites=true&q=chat+noir&before=12'],
    ])
  })

  it('uploads files in the "files" field with the progress callback', async () => {
    const onProgress = vi.fn()
    await assetsApi.upload([new File(['a'], 'a.png'), new File(['b'], 'b.png')], { onProgress })
    const [path, form, options] = studioUpload.mock.calls[0] as unknown as [string, FormData, { onProgress: unknown }]
    expect(path).toBe('/assets')
    expect(form.getAll('files')).toHaveLength(2)
    expect(options.onProgress).toBe(onProgress)
  })

  it('toggles the favorite and deletes an asset', async () => {
    await assetsApi.setFavorite('a1', true)
    await assetsApi.remove('a1')
    expect(studioRequest.mock.calls).toEqual([
      ['patch', '/assets/a1', { favorite: true }],
      ['delete', '/assets/a1'],
    ])
  })
})
