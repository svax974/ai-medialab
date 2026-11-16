/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useEffect, useRef } from 'react'
import { useLiveResource } from '@/modules_shared/common/core/events'
import { transcriptApi } from '../services/transcriptApi'

const TOPICS = ['studio.transcription.updated', 'studio.transcription.deleted']

/** Server events drive updates; common's polling fallback applies only when the stream is unavailable. */
export function useTranscripts(query: string) {
  const resource = useLiveResource(() => transcriptApi.list(query), { topics: TOPICS, fallbackPollMs: 5000 })
  const { refetch } = resource
  const previous = useRef(query)
  useEffect(() => {
    if (previous.current === query) return
    previous.current = query
    void refetch()
  }, [query, refetch])
  return resource
}

export function useTranscript(id: string) {
  return useLiveResource(() => transcriptApi.get(id), { topics: TOPICS, fallbackPollMs: 5000,
    match: (event) => (event.data as { id?: string } | undefined)?.id === id })
}
