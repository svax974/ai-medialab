/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { STUDIO_TOPICS } from '@/modules/studio-core/lib/studioEvents'
import { chatKeys } from '../lib/chatKeys'
import { generationMessageIds, concernsGeneration } from '../lib/generationEvents'
import { anyStreaming, useChatLiveStore } from '../state/chatLiveStore'
import { useChatConversation } from './useChat'

const COALESCE_MS = 250

/**
 * Keeps the generations of the answers in step with the queue: the cards read their state and files from the server
 * (they live in `studio-core`), so an event about one of their jobs re-reads the conversation (coalesced). Nothing is
 * read while an answer streams: the stream owns the cache then, and no job can start before it ends.
 */
export function useGenerationSync(conversationId: string): void {
  const queryClient = useQueryClient()
  const { data } = useChatConversation(conversationId)
  const watched = useRef<ReadonlySet<string>>(new Set())
  watched.current = generationMessageIds(data?.messages ?? [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const reload = () => {
      timer = undefined
      if (!anyStreaming(useChatLiveStore.getState())) void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
    }
    const unsubscribe = eventStreamClient.subscribe(
      [...STUDIO_TOPICS], // the ones that matter (a job's state, its files, its deletion) are told apart by `concernsGeneration`
      (event) => {
        if (watched.current.size > 0 && concernsGeneration(event, watched.current)) timer ??= setTimeout(reload, COALESCE_MS)
      },
      { onResync: reload },
    )
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [conversationId, queryClient])
}
