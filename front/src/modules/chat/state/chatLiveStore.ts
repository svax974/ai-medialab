/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { registerPrivateCleanup } from '@/modules/private/lib/privateChatMemory'
import type { ChatErrorCode, LlmStatus } from '../types'

/** The loading of the model as the answer stream reports it. */
export interface LoadingState {
  phase: 'starting' | 'loading' | 'ready'
  modelId: string
  /** Seconds the engine says it has been loading (a clock is drawn from `since` meanwhile). */
  elapsed: number | null
  /** The context asked for was not the loaded one: the model reloads (see `loadingLabel`). */
  reloadContext: number | null
}

export interface StreamFailure {
  code: ChatErrorCode
  message: string
  /** The answer that failed (what "Continue anyway" regenerates). */
  id?: string
}

/** An answer being written, per conversation: what the thread draws around the messages (loading, stop, error). */
export interface LiveStream {
  controller: AbortController
  startedAt: number
  loading: LoadingState | null
  error: StreamFailure | null
  /** Ended (done, error or stopped): the error stays visible until the next send. */
  active: boolean
}

interface ChatLiveState {
  streams: Record<string, LiveStream>
  begin: (conversationId: string, controller: AbortController, reloadContext: number | null) => void
  loading: (conversationId: string, phase: LoadingState['phase'], modelId: string, elapsed: number | null) => void
  fail: (conversationId: string, error: StreamFailure) => void
  end: (conversationId: string) => void
  dismiss: (conversationId: string) => void
  /** The engine's state of the chat model (`engine.llm.status`), `null` until it is known. */
  status: LlmStatus | null
  setStatus: (status: LlmStatus | null) => void
}

export const useChatLiveStore = create<ChatLiveState>()((set) => ({
  streams: {},
  status: null,
  begin: (id, controller, reloadContext) =>
    set((state) => ({
      streams: { ...state.streams, [id]: { controller, startedAt: Date.now() / 1000, loading: reloadContext === null ? null : { phase: 'starting', modelId: '', elapsed: null, reloadContext }, error: null, active: true } },
    })),
  loading: (id, phase, modelId, elapsed) =>
    set((state) => {
      const stream = state.streams[id]
      if (!stream) return state
      const reload = stream.loading?.reloadContext ?? null
      return { streams: { ...state.streams, [id]: { ...stream, loading: phase === 'ready' ? null : { phase, modelId, elapsed, reloadContext: reload } } } }
    }),
  fail: (id, error) => set((state) => (state.streams[id] ? { streams: { ...state.streams, [id]: { ...state.streams[id], error, loading: null, active: false } } } : state)),
  end: (id) => set((state) => (state.streams[id] ? { streams: { ...state.streams, [id]: { ...state.streams[id], loading: null, active: false } } } : state)),
  dismiss: (id) =>
    set((state) => {
      const streams = { ...state.streams }
      delete streams[id]
      return { streams }
    }),
  setStatus: (status) => set({ status }),
}))

/** Whether any conversation has an answer in progress (one model, one answer at a time). */
export const anyStreaming = (state: Pick<ChatLiveState, 'streams'>): boolean => Object.values(state.streams).some((s) => s.active)

// Private generation: the answers being read and their errors go with the session (the engine's state of the model stays).
registerPrivateCleanup(() => useChatLiveStore.setState({ streams: {} }))
