/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { dropQueued, enqueueJobs, setJobStatus, type AdviceJob, type AdviceJobStatus } from '../lib/adviceQueue'
import type { AnalysisJob } from '../lib/advice'

/** The analyses asked for (one at a time, see `useAdviceRunner`). Not persisted: it only lives while the dialog is open. */
interface AdviceState {
  queue: AdviceJob[]
  enqueue: (jobs: AnalysisJob[]) => void
  setStatus: (key: string, status: AdviceJobStatus, error?: string | null, code?: string | null) => void
  /** Forgets the analyses still waiting. */
  dropQueued: () => void
  clear: () => void
}

export const useAdviceStore = create<AdviceState>()((set) => ({
  queue: [],
  enqueue: (jobs) => set((s) => ({ queue: enqueueJobs(s.queue, jobs) })),
  setStatus: (key, status, error = null, code = null) => set((s) => ({ queue: setJobStatus(s.queue, key, status, error, code) })),
  dropQueued: () => set((s) => ({ queue: dropQueued(s.queue) })),
  clear: () => set({ queue: [] }),
}))

/**
 * Preferences of the update dialog. `autoAdvice`: after each check, analyse the risks of the updates on its own (it loads a model
 * into memory, so it is off by default). Kept in the browser like the other interface preferences (`cn-prefs`, `cn-models`): the
 * server never acts on it, only the dialog does.
 */
interface UpdatesPrefs {
  autoAdvice: boolean
  setAutoAdvice: (value: boolean) => void
}

export const useUpdatesPrefs = create<UpdatesPrefs>()(
  persist((set) => ({ autoAdvice: false, setAutoAdvice: (autoAdvice) => set({ autoAdvice }) }), { name: 'cn-updates' }),
)
