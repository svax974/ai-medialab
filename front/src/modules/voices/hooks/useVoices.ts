/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { voiceKeys } from '../lib/voiceKeys'
import { voicesApi } from '../services/voicesApi'
import type { Voice } from '../types'

export const VOICES_TOPIC = 'studio.voices.changed'

/** The library, newest first. Kept fresh by `useVoiceEvents` (an invalidation event), so a minute of staleness is enough. */
export function useVoices() {
  return useQuery<Voice[]>({ queryKey: voiceKeys.all, queryFn: voicesApi.list, staleTime: 60_000 })
}

/** Re-reads the library when the server says it changed (any tab, any action) and after a stream resync. Mounted once by the shell. */
export function useVoiceEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: voiceKeys.all })
    return eventStreamClient.subscribe([VOICES_TOPIC], invalidate, { onResync: invalidate })
  }, [queryClient])
}
