/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { ChatError } from '../lib/errors'
import { chatKeys } from '../lib/chatKeys'
import { contextChangeReloads } from '../lib/context'
import { applyStreamEvent } from '../lib/streamReducer'
import { anyStreaming, useChatLiveStore } from '../state/chatLiveStore'
import { useChatDraftStore } from '../state/chatDraftStore'
import type { ChatConversation, ChatStreamEvent } from '../types'
import { streamAnswer, type AnswerBody } from './chatApi'

export interface AnswerRequest {
  path: string
  body: AnswerBody
  /** Key of the draft to empty once the server has the message (a send or an edit). */
  draftKey?: string
  /** The model and the context this answer asks for: tells a context change (the model reloads) from a plain load. */
  modelId: string
  requestedContext: number | null
}

/**
 * Streams that stay open after their `done`, for the automatic title that follows it. The answer is finished at `done`
 * (the thread, the send button and the actions do not wait); a new answer drops them, which makes the server cancel the title.
 */
const residual = new Map<string, AbortController>()

/** Writes an event into the conversation of the cache, and keeps the messages this browser has seen. */
function applyToCache(queryClient: QueryClient, conversationId: string, event: ChatStreamEvent): void {
  queryClient.setQueryData<ChatConversation>(chatKeys.conversation(conversationId), (conversation) => {
    if (!conversation) return conversation
    const next = applyStreamEvent(conversation, event)
    if (event.type === 'message' || event.type === 'done') useChatDraftStore.getState().remember(next.messages)
    return next
  })
}

function handle(queryClient: QueryClient, conversationId: string, request: AnswerRequest, event: ChatStreamEvent): void {
  const live = useChatLiveStore.getState()
  if (event.type === 'loading') return live.loading(conversationId, event.phase, event.model_id, event.elapsed_s ?? null)
  applyToCache(queryClient, conversationId, event)
  if (event.type === 'message' && event.message.role === 'user' && request.draftKey) useChatDraftStore.getState().clear(request.draftKey)
  if (event.type === 'title') {
    void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
    void queryClient.invalidateQueries({ queryKey: studioKeys.conversation(conversationId) })
  }
  if (event.type === 'error') live.fail(conversationId, { code: event.code, message: event.message })
}

/**
 * Starts an answer (a send, a regeneration or an edit) and streams it into the cache of the conversation. It goes on if
 * the page is left (the Stop button aborts it); one answer at a time, as the engine holds one model. Returns `false`
 * when another answer is in progress.
 */
export function startAnswer(queryClient: QueryClient, conversationId: string, request: AnswerRequest): boolean {
  const live = useChatLiveStore.getState()
  if (anyStreaming(live)) {
    toast.error(i18n.get('chat.error.alreadyAnswering'))
    return false
  }
  // The model is free for this answer: a title still being written is given up (the server cancels it when the stream goes).
  for (const open of residual.values()) open.abort()
  residual.clear()
  const controller = new AbortController()
  const reload = contextChangeReloads(request.requestedContext, live.status, request.modelId) ? request.requestedContext : null
  live.begin(conversationId, controller, reload)
  /** The stream of this answer is still the one the conversation shows (a later answer may have replaced it). */
  const isCurrent = () => useChatLiveStore.getState().streams[conversationId]?.controller === controller
  let finished = false
  const onEvent = (event: ChatStreamEvent) => {
    handle(queryClient, conversationId, request, event)
    if (event.type !== 'done') return
    // The answer is over: the thread, the statistics and the send button are ready. The stream goes on for the title.
    finished = true
    residual.set(conversationId, controller)
    if (isCurrent()) useChatLiveStore.getState().end(conversationId)
  }
  void (async () => {
    try {
      await streamAnswer(request.path, request.body, { signal: controller.signal, onEvent })
    } catch (error) {
      const failure = error instanceof ChatError ? error : new ChatError((error as Error).message, 'upstream')
      if (isCurrent() && !finished) useChatLiveStore.getState().fail(conversationId, { code: failure.code, message: failure.message })
    } finally {
      if (residual.get(conversationId) === controller) residual.delete(conversationId)
      if (isCurrent()) useChatLiveStore.getState().end(conversationId)
      // After a stop or an error the server's message is the truth (text received, status): read it again. Not after `done`:
      // the answer was complete, and dropping the stream that waits for a title must not reload a conversation being written.
      if (!finished && isCurrent() && (controller.signal.aborted || useChatLiveStore.getState().streams[conversationId]?.error)) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
      }
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
    }
  })()
  return true
}

/** Stops the answer of a conversation (the server keeps the text received and marks the message cancelled). */
export function stopAnswer(conversationId: string): void {
  useChatLiveStore.getState().streams[conversationId]?.controller.abort()
}
