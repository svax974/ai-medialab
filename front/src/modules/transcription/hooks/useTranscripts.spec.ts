/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { useLiveResource } from '@/modules_shared/common/core/events'
import { transcriptApi } from '../services/transcriptApi'
import { useTranscript, useTranscripts } from './useTranscripts'

vi.mock('@/modules_shared/common/core/events', () => ({ useLiveResource: vi.fn(() => ({ refetch: vi.fn() })) }))
vi.mock('../services/transcriptApi', () => ({ transcriptApi: { get: vi.fn(), list: vi.fn() } }))

it('uses common live updates, matching only the open document and letting common handle disconnected fallback', async () => {
  function Probe() { useTranscript('one'); return null }
  renderToStaticMarkup(createElement(Probe))
  const [fetcher, options] = vi.mocked(useLiveResource).mock.calls[0]
  expect(options.topics).toEqual(['studio.transcription.updated', 'studio.transcription.deleted'])
  expect(options.match?.({ data: { id: 'one' } } as never)).toBe(true)
  expect(options.match?.({ data: { id: 'other' } } as never)).toBe(false)
  expect(options.fallbackPollMs).toBe(5000)
  await fetcher()
  expect(transcriptApi.get).toHaveBeenCalledWith('one')
})

it('loads the current search through the same event subscription', async () => {
  vi.clearAllMocks()
  function Probe() { useTranscripts('interview'); return null }
  renderToStaticMarkup(createElement(Probe))
  const [fetcher, options] = vi.mocked(useLiveResource).mock.calls[0]
  await fetcher()
  expect(transcriptApi.list).toHaveBeenCalledWith('interview')
  expect(options.topics).toContain('studio.transcription.deleted')
})
