/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { useChatLiveStore } from '../state/chatLiveStore'
import type { LlmStatus } from '../types'

/** Topic of the chat model's state, relayed by Nest (the engine replays it on every connection). */
export const LLM_STATUS_TOPIC = 'engine.llm.status'

const STATES = new Set(['idle', 'loading', 'ready', 'generating'])

/** Narrows an event payload to the model's state (the stream carries untrusted JSON). */
export function parseLlmStatus(data: unknown): LlmStatus | null {
  const d = data as Partial<LlmStatus> | null | undefined
  if (!d || typeof d.state !== 'string' || !STATES.has(d.state)) return null
  return { state: d.state, model_id: d.model_id ?? null, variant: d.variant ?? null, context_size: typeof d.context_size === 'number' ? d.context_size : null, vision: d.vision, started_at: d.started_at ?? null, last_error: d.last_error ?? null }
}

/** Keeps the state of the chat model (loaded, its context, generating) in the live store; unknown again after a resync. */
export function useLlmEvents(): void {
  useEffect(() => {
    return eventStreamClient.subscribe(
      [LLM_STATUS_TOPIC],
      (event) => {
        const status = parseLlmStatus(event.data)
        if (status) useChatLiveStore.getState().setStatus(status)
      },
      { onResync: () => useChatLiveStore.getState().setStatus(null) },
    )
  }, [])
}
