/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async () => ({})))
const studioUpload = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest, studioUpload }))

import { voicesApi } from './voicesApi'

describe('voicesApi', () => {
  beforeEach(() => {
    studioRequest.mockClear()
    studioUpload.mockClear()
  })

  it('reads the library and keeps a take as a voice', async () => {
    await voicesApi.list()
    await voicesApi.fromAsset({ asset_id: 'a1', name: 'N', kind: 'design' })
    expect(studioRequest.mock.calls).toEqual([['get', '/voices'], ['post', '/voices/from-asset', { asset_id: 'a1', name: 'N', kind: 'design' }]])
  })

  it('creates a voice by multipart upload', async () => {
    const form = new FormData()
    await voicesApi.create(form)
    expect(studioUpload.mock.calls).toEqual([['/voices', form]])
  })

  it('edits, deletes and transcribes by voice id, encoded', async () => {
    await voicesApi.patch('a/b', { transcript: 'texte' })
    await voicesApi.remove('v1')
    await voicesApi.transcribe('v1', { language: 'fr' })
    await voicesApi.transcribe('v1')
    expect(studioRequest.mock.calls).toEqual([
      ['patch', '/voices/a%2Fb', { transcript: 'texte' }],
      ['delete', '/voices/v1'],
      ['post', '/voices/v1/transcribe', { language: 'fr' }],
      ['post', '/voices/v1/transcribe', {}],
    ])
  })
})
