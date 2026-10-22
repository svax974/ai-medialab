/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { IDLE_RUN } from '../lib/setupDialog'
import type { SetupRun } from '../types'

/** The model whose setup the confirmation dialog shows, and the live state of the run (event stream). */
interface SetupStoreState {
  dialogModelId: string | null
  run: SetupRun
  /** Opens the dialog for a model; an old finished run does not show again. */
  open: (modelId: string) => void
  close: () => void
  setRun: (run: SetupRun) => void
}

export const useSetupStore = create<SetupStoreState>()((set, get) => ({
  dialogModelId: null,
  run: IDLE_RUN,
  open: (dialogModelId) => set({ dialogModelId, run: get().run.state === 'running' ? get().run : IDLE_RUN }),
  close: () => set({ dialogModelId: null }),
  setRun: (run) => set({ run }),
}))
