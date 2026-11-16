/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { useTranscripts, useTranscript } from '../hooks/useTranscripts'
import { TranscriptSource } from './TranscriptSource'
import { TranscriptSidebarList } from './TranscriptSidebarList'
import { TranscriptResult } from './TranscriptResult'

vi.mock('../hooks/useTranscripts', () => ({ useTranscripts: vi.fn(), useTranscript: vi.fn() }))
vi.mock('@/modules/studio-shell/hooks/useT', () => ({ useT: () => (key: string) => key }))
vi.mock('../services/transcriptApi', () => ({ transcriptApi: { exportUrl: () => '/export' } }))

function render(element: ReactNode) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, element)))
}

it('shows the source field and accessible file picker', () => {
  const common = { file: null, url: '', disabled: false, issue: null, onFile: vi.fn(), onUrl: vi.fn() }
  expect(render(createElement(TranscriptSource, { ...common, kind: 'youtube' }))).toContain('type="url"')
  const file = render(createElement(TranscriptSource, { ...common, kind: 'file' }))
  expect(file).toContain('type="file"')
  expect(file).toContain('.mp4')
})

it('shows searchable history, progress and sort controls', () => {
  vi.mocked(useTranscripts).mockReturnValue({ data: [{ id: 'one', title: 'Film', status: 'running', stage: 'transcribing', created_at: 1 }], loading: false, error: null } as unknown as ReturnType<typeof useTranscripts>)
  const html = render(createElement(TranscriptSidebarList, { query: '' }))
  expect(html).toContain('Film')
  expect(html).toContain('transcription.date')
  expect(html).toContain('transcription.stage.transcribing')
  expect(html).toContain('progressbar')
})

it('renders transcript text as escaped plain text and preserves failed partial output', () => {
  vi.mocked(useTranscript).mockReturnValue({ data: { id: 'one', title: 'Film', model_name: 'Whisper', status: 'failed', stage: 'failed', text: '<script>bad</script>', error: 'memory refusal', duration: 120, processed_seconds: 60, source_url: null }, loading: false, error: null, refetch: async () => undefined } as unknown as ReturnType<typeof useTranscript>)
  const html = render(createElement(TranscriptResult, { id: 'one' }))
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(html).not.toContain('<script>bad')
  expect(html).toContain('memory refusal')
  expect(html).toContain('transcription.save')
})
