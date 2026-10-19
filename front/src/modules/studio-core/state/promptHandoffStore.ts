/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { registerPrivateCleanup } from '@/modules/private/lib/privateChatMemory'

/** The studios that take a text from another one (the chat's "use as prompt"). */
export type HandoffTarget = 'image' | 'video' | 'audio' | 'diagram'

/** A text waiting for the composer of `target` (memory only: never written to the browser's storage). */
export interface PendingHandoff {
  target: HandoffTarget
  text: string
}

interface PromptHandoffState {
  pending: PendingHandoff | null
  /** Leaves a text for the composer of `target` (it replaces what was waiting). */
  send: (target: HandoffTarget, text: string) => void
  /** Takes the text waiting for `target`, if any: it is gone afterwards. */
  take: (target: HandoffTarget) => string | null
}

/**
 * How one studio hands a text to another without importing it: the chat writes here, the composer of the target reads when it
 * shows (`usePromptHandoff`). Kept in memory on purpose: a prompt that travelled between studios is not stored.
 */
export const usePromptHandoffStore = create<PromptHandoffState>()((set, get) => ({
  pending: null,
  send: (target, text) => set({ pending: { target, text } }),
  take: (target) => {
    const pending = get().pending
    if (!pending || pending.target !== target) return null
    set({ pending: null })
    return pending.text
  },
}))

// Private generation: a text that was handed over and not taken yet goes with the session.
registerPrivateCleanup(() => usePromptHandoffStore.setState({ pending: null }))
