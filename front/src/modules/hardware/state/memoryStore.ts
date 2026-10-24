/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { MemoryLive } from '../types'

/** The latest memory reading (the engine pushes one every couple of seconds); null until the first one arrives. */
interface MemoryState {
  sample: MemoryLive | null
  set: (sample: MemoryLive) => void
}

export const useMemoryStore = create<MemoryState>((set) => ({ sample: null, set: (sample) => set({ sample }) }))
