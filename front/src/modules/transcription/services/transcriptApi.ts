/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { studioApiBase, studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import type { CreateTranscript, Transcript, TranscriptDetail } from '../types'

export const transcriptApi = {
  list: (query = '') => studioRequest<Transcript[]>('get', `/transcripts${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  get: (id: string) => studioRequest<TranscriptDetail>('get', `/transcripts/${encodeURIComponent(id)}`),
  create(input: CreateTranscript, onProgress?: (percent: number | null) => void): Promise<Transcript> {
    const form = new FormData()
    if (input.file) form.append('file', input.file, input.file.name)
    if (input.url) form.append('url', input.url)
    form.append('model_id', input.modelId)
    if (input.language !== 'auto') form.append('language', input.language)
    return studioUpload<Transcript>('/transcripts', form, { onProgress })
  },
  edit: (id: string, text: string) => studioRequest<TranscriptDetail>('patch', `/transcripts/${encodeURIComponent(id)}`, { text }),
  retry: (id: string) => studioRequest<Transcript>('post', `/transcripts/${encodeURIComponent(id)}/retry`),
  cancel: (id: string) => studioRequest<Transcript>('post', `/transcripts/${encodeURIComponent(id)}/cancel`),
  remove: (id: string) => studioRequest<{ ok: true }>('delete', `/transcripts/${encodeURIComponent(id)}`),
  exportUrl: (id: string) => `${studioApiBase()}/transcripts/${encodeURIComponent(id)}/export`,
}
