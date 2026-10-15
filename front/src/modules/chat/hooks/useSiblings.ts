/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { missingSiblings } from '../lib/branches'
import { chatKeys } from '../lib/chatKeys'
import { chatApi } from '../services/chatApi'
import { useChatDraftStore } from '../state/chatDraftStore'
import type { ChatMessage } from '../types'

/** A page reloaded in a conversation with several answers to compare reads the others once; they stay valid for a minute. */
const SIBLINGS_STALE_MS = 60_000

/**
 * Reads the answers that are siblings of an answer of the active branch but that this browser has not seen (the
 * conversation payload carries the active branch only), so that the side-by-side comparison survives a reload.
 */
export function useSiblingsSync(conversationId: string, messages: readonly ChatMessage[]): void {
  const queryClient = useQueryClient()
  const seen = useChatDraftStore((s) => s.seen)
  const remember = useChatDraftStore((s) => s.remember)
  useEffect(() => {
    const known = new Map(Object.entries(seen))
    for (const message of messages) {
      if (!missingSiblings(message, known)) continue
      void queryClient
        .fetchQuery({ queryKey: chatKeys.siblings(conversationId, message.id), queryFn: () => chatApi.siblings(conversationId, message.id), staleTime: SIBLINGS_STALE_MS })
        .then(remember)
        .catch(() => undefined) // a comparison is a convenience: the branch navigator still works without it
    }
  }, [conversationId, messages, seen, queryClient, remember])
}
