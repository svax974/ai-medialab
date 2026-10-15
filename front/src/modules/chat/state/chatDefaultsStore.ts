/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { ChatSettings, ChatSettingsPatch } from '../types'

/** Settings a new conversation starts with. */
export const BASE_SETTINGS: ChatSettings = {
  model_id: null,
  system_prompt: '',
  params: {},
  context_size: null,
  reasoning: 'auto',
  tools: { web: false },
  leaf_id: null,
}

/**
 * The settings of the chat home page (`cn-chat-defaults`): what the composer edits before a conversation exists. The
 * conversation created by the first message receives them; afterwards it keeps its own.
 */
interface ChatDefaultsState {
  settings: ChatSettings
  merge: (patch: ChatSettingsPatch) => void
}

export const useChatDefaultsStore = create<ChatDefaultsState>()(
  persist(
    (set) => ({
      settings: BASE_SETTINGS,
      merge: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
    }),
    { name: 'cn-chat-defaults', storage: privacyStorage(), merge: (saved, current) => ({ ...current, settings: { ...BASE_SETTINGS, ...((saved as Partial<ChatDefaultsState> | undefined)?.settings ?? {}) } }) },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useChatDefaultsStore)
