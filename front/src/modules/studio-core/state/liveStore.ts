/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { JobProgress } from '../types'

/** Live progress of the running generations, by message id (from `studio.job.progress`; not part of the query cache). */
interface LiveState {
  progress: Record<string, JobProgress>
  /** Merges an event over the previous one: an event carries only what changed (a preview, a step...). */
  setProgress: (progress: JobProgress) => void
  clearProgress: (messageId: string) => void
  clear: () => void
}

export const useLiveStore = create<LiveState>()((set) => ({
  progress: {},
  setProgress: (progress) => set((state) => ({ progress: { ...state.progress, [progress.message_id]: { ...state.progress[progress.message_id], ...progress } } })),
  clearProgress: (messageId) =>
    set((state) => {
      if (!(messageId in state.progress)) return state
      const next = { ...state.progress }
      delete next[messageId]
      return { progress: next }
    }),
  clear: () => set({ progress: {} }),
}))
