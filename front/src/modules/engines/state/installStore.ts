/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { EngineInstallState, PackInstallState } from '../types'

/** Live state of the installers (event stream) and the model to download once its engine is installed. */
interface InstallState {
  packInstall: PackInstallState
  engineInstall: EngineInstallState
  /** Model to download as soon as its engine is installed (two steps behind one click). */
  pendingModelId: string | null
  setPackInstall: (state: PackInstallState) => void
  setEngineInstall: (state: EngineInstallState) => void
  setPending: (modelId: string | null) => void
  /** After a stream reconnection the system state is the source again. */
  reset: () => void
}

export const useInstallStore = create<InstallState>()((set) => ({
  packInstall: { state: 'idle' },
  engineInstall: { state: 'idle' },
  pendingModelId: null,
  setPackInstall: (packInstall) => set({ packInstall }),
  setEngineInstall: (engineInstall) => set({ engineInstall }),
  setPending: (pendingModelId) => set({ pendingModelId }),
  reset: () => set({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' } }),
}))
