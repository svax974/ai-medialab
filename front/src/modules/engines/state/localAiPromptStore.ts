/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The launch invitation to install the local AI (`LocalAiLaunchDialog`). `optOut` ("do not offer it again") is kept in the browser
 * like the other interface preferences (`cn-prefs`, `cn-models`, `cn-updates`): the server never acts on it. `dismissed` only lasts
 * until the application is closed: the invitation comes back at the next launch while `optOut` is off.
 */
interface LocalAiPromptState {
  optOut: boolean
  dismissed: boolean
  setOptOut: (value: boolean) => void
  dismiss: () => void
}

export const useLocalAiPromptStore = create<LocalAiPromptState>()(
  persist(
    (set) => ({ optOut: false, dismissed: false, setOptOut: (optOut) => set({ optOut }), dismiss: () => set({ dismissed: true }) }),
    { name: 'cn-local-ai', partialize: (state) => ({ optOut: state.optOut }) },
  ),
)
