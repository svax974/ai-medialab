/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { ChatAttachment, ChatMessage, SendBody } from '../types'

/** Key of the draft of a new chat (the home page, before a conversation exists). */
export const HOME_DRAFT = 'new'

/** A send that waits for the conversation page to start it (the home page creates the conversation, then opens it). */
export interface PendingSend {
  conversationId: string
  body: SendBody
  /** Draft to empty once the server has the message. */
  draftKey: string
  modelId: string
  requestedContext: number | null
}

/**
 * Client state of the chat: the unsent text of each conversation (kept across reloads, `cn-chat-drafts`), the files
 * attached to the next message, the send the home page hands over, and the messages this browser has seen (the
 * conversation payload carries the active branch only: the other answers are kept here to compare them).
 */
interface ChatDraftState {
  texts: Record<string, string>
  attachments: Record<string, ChatAttachment[]>
  pending: PendingSend | null
  seen: Record<string, ChatMessage>
  setText: (key: string, text: string) => void
  setAttachments: (key: string, attachments: ChatAttachment[]) => void
  clear: (key: string) => void
  setPending: (pending: PendingSend | null) => void
  remember: (messages: readonly ChatMessage[]) => void
}

/** Bound on the messages kept for comparison (the most recent ones win). */
export const SEEN_LIMIT = 400

export const useChatDraftStore = create<ChatDraftState>()(
  persist(
    (set) => ({
      texts: {},
      attachments: {},
      pending: null,
      seen: {},
      setText: (key, text) =>
        set((state) => {
          const texts = { ...state.texts }
          if (text === '') delete texts[key]
          else texts[key] = text
          return { texts }
        }),
      setAttachments: (key, attachments) => set((state) => ({ attachments: { ...state.attachments, [key]: attachments } })),
      clear: (key) =>
        set((state) => {
          const texts = { ...state.texts }
          const attachments = { ...state.attachments }
          delete texts[key]
          delete attachments[key]
          return { texts, attachments }
        }),
      setPending: (pending) => set({ pending }),
      remember: (messages) =>
        set((state) => {
          const seen = { ...state.seen }
          for (const m of messages) if (m.status !== 'streaming') seen[m.id] = m
          const ids = Object.keys(seen)
          if (ids.length > SEEN_LIMIT) for (const id of ids.slice(0, ids.length - SEEN_LIMIT)) delete seen[id]
          return { seen }
        }),
    }),
    { name: 'cn-chat-drafts', storage: privacyStorage(), partialize: (state) => ({ texts: state.texts }) },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useChatDraftStore)
