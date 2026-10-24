/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { hardwareApi } from '../services/hardwareApi'
import { useMemoryStore } from '../state/memoryStore'
import type { MemoryLive } from '../types'

export const MEMORY_TOPIC = 'engine.memory.sample'

/** Follows the memory readings pushed by the engine (`engine.memory.sample`), after one read at once. No polling. */
export function useMemoryFeed(): MemoryLive | null {
  const sample = useMemoryStore((s) => s.sample)
  useEffect(() => {
    const set = useMemoryStore.getState().set
    let live = true
    hardwareApi.memory().then((first) => live && set(first), () => undefined)
    const unsubscribe = eventStreamClient.subscribe([MEMORY_TOPIC], (event) => {
      const data = event.data as Partial<MemoryLive> | undefined
      if (data && typeof data.used_pct === 'number') set(data as MemoryLive)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return sample
}
