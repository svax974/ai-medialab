/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { QueueState } from '../types'

interface QueueStoreState extends QueueState {
  /** False until the first answer (`GET /api/queue`) or event: positions are then unknown, not zero. */
  loaded: boolean
  set: (state: QueueState) => void
}

/** The generation queue, kept current by `studio.queue.updated` (one list for every conversation and mode). */
export const useQueueStore = create<QueueStoreState>()((set) => ({
  current: null,
  queue: [],
  loaded: false,
  set: (state) => set({ current: state.current, queue: state.queue, loaded: true }),
}))
