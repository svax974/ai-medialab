/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { beforeEach, expect, it, vi } from 'vitest'
import { studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import { transcriptApi } from './transcriptApi'

vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest: vi.fn(), studioUpload: vi.fn(), studioApiBase: () => '/api/v1' }))
beforeEach(() => vi.clearAllMocks())

it('uploads a file with model and language and sends YouTube as a separate source', async () => {
  const file = new File(['audio'], 'clip.mp4')
  await transcriptApi.create({ file, modelId: 'whisper', language: 'auto' })
  let form = vi.mocked(studioUpload).mock.calls[0][1]
  expect((form.get('file') as File).name).toBe('clip.mp4')
  expect(await (form.get('file') as File).text()).toBe('audio')
  expect(form.get('model_id')).toBe('whisper')
  expect(form.has('language')).toBe(false)
  expect(form.has('url')).toBe(false)
  await transcriptApi.create({ url: 'https://youtu.be/abcdefghijk', modelId: 'whisper', language: 'fr' })
  form = vi.mocked(studioUpload).mock.calls[1][1]
  expect(form.get('url')).toContain('youtu.be')
  expect(form.get('language')).toBe('fr')
  expect(form.has('file')).toBe(false)
})

it('uses the Nest studio transport for history and actions, encoding identifiers and searches', async () => {
  await transcriptApi.list('a & b')
  await transcriptApi.get('a/b')
  await transcriptApi.edit('t', 'corrected')
  await transcriptApi.retry('t')
  await transcriptApi.cancel('t')
  await transcriptApi.remove('t')
  expect(vi.mocked(studioRequest).mock.calls).toEqual([
    ['get', '/transcripts?q=a%20%26%20b'], ['get', '/transcripts/a%2Fb'],
    ['patch', '/transcripts/t', { text: 'corrected' }], ['post', '/transcripts/t/retry'],
    ['post', '/transcripts/t/cancel'], ['delete', '/transcripts/t'],
  ])
  expect(transcriptApi.exportUrl('a/b')).toBe('/api/v1/transcripts/a%2Fb/export')
})
