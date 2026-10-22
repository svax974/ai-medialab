/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { EngineInstallState, PackInstallState } from '../types'

/** Live state of the installers (event stream). */
interface InstallState {
  packInstall: PackInstallState
  engineInstall: EngineInstallState
  /** llama.cpp (the chat's engine): same shape as stable-diffusion.cpp's installation. */
  llamacppInstall: EngineInstallState
  setPackInstall: (state: PackInstallState) => void
  setEngineInstall: (state: EngineInstallState) => void
  setLlamacppInstall: (state: EngineInstallState) => void
  /** After a stream reconnection the system state is the source again. */
  reset: () => void
}

export const useInstallStore = create<InstallState>()((set) => ({
  packInstall: { state: 'idle' },
  engineInstall: { state: 'idle' },
  llamacppInstall: { state: 'idle' },
  setPackInstall: (packInstall) => set({ packInstall }),
  setEngineInstall: (engineInstall) => set({ engineInstall }),
  setLlamacppInstall: (llamacppInstall) => set({ llamacppInstall }),
  reset: () => set({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' }, llamacppInstall: { state: 'idle' } }),
}))
