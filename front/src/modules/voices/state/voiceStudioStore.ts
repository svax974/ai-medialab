/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { VoiceStudioTarget } from '../types'

/** The voice studio dialog (record, import, design, edit): `null` is closed. Opened from the composer, the library and the window drop. */
interface VoiceStudioState {
  target: VoiceStudioTarget | null
  open: (target?: VoiceStudioTarget) => void
  close: () => void
}

export const useVoiceStudioStore = create<VoiceStudioState>()((set) => ({
  target: null,
  open: (target) => set({ target: target ?? {} }),
  close: () => set({ target: null }),
}))
