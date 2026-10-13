/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { ENGINE_TOPICS, effectOfEvent, effectOfResync, type CacheEffect } from '../lib/eventEffects'

/** Lists are refreshed at most once per window: a generation emits many events in a burst. */
const COALESCE_MS = 250

function apply(queryClient: QueryClient, effect: CacheEffect): void {
  for (const queryKey of effect.remove) queryClient.removeQueries({ queryKey })
  for (const queryKey of effect.invalidate) void queryClient.invalidateQueries({ queryKey })
}

/**
 * Keeps the TanStack Query cache in step with the engine: subscribes once (one connection per tab, shared with the
 * other consumers of the stream) to the `engine.*` topics relayed by Nest and turns events into invalidations
 * (`effectOfEvent`). `resync` (replay impossible after a reconnection) re-reads everything.
 * While the stream is unavailable (`fallback`), the queries' own refetch on mount/focus applies.
 */
export function useEngineEventSync(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: CacheEffect[] = []
    const flush = () => {
      const batch = pending
      pending = []
      timer = undefined
      for (const effect of batch) apply(queryClient, effect)
    }
    const schedule = (effect: CacheEffect) => {
      if (effect.invalidate.length === 0 && effect.remove.length === 0) return
      pending.push(effect)
      timer ??= setTimeout(flush, COALESCE_MS)
    }
    const unsubscribe = eventStreamClient.subscribe([...ENGINE_TOPICS], (event) => schedule(effectOfEvent(event)), {
      onResync: () => schedule(effectOfResync()),
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [queryClient])
}
