/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { ChatMessage, ChatSettings, LlmStatus } from '../types'
import { estimateTokens } from './estimate'

/** Context fill levels: a warning from 75 %, "almost full" from 90 %. */
export const CONTEXT_WARN = 0.75
export const CONTEXT_FULL = 0.9
/** The engine never opens a context below this (its own bound). */
export const CONTEXT_MIN = 256

export interface ContextUsage {
  used: number
  limit: number
  ratio: number
  level: 'ok' | 'warn' | 'full'
}

/**
 * How full the context is: the tokens of the last answer's request plus its own (the engine counts them exactly), else an
 * estimate from the text, plus the draft being typed. `null` while the size of the context is not known.
 */
export function contextUsage(messages: readonly ChatMessage[], limit: number | null, draftTokens = 0): ContextUsage | null {
  if (!limit || limit <= 0) return null
  const counted = [...messages].reverse().find((m) => m.role === 'assistant' && m.stats)
  const used = (counted?.stats ? counted.stats.prompt_tokens + counted.stats.completion_tokens : messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)) + draftTokens
  const ratio = Math.min(used / limit, 1.5)
  return { used, limit, ratio, level: ratio >= CONTEXT_FULL ? 'full' : ratio >= CONTEXT_WARN ? 'warn' : 'ok' }
}

/**
 * The context the next answer will ask the engine for: the conversation's own setting, else the model's default, bounded
 * by what the model supports (the engine clamps the same way, so a request beyond the maximum is not a change).
 */
export function requestedContext(settings: Pick<ChatSettings, 'context_size'>, model: Pick<ModelInfo, 'llm'> | undefined): number | null {
  const caps = model?.llm
  const asked = settings.context_size ?? caps?.context_default ?? null
  if (asked === null) return null
  return caps ? Math.min(Math.max(asked, CONTEXT_MIN), caps.context_max) : Math.max(asked, CONTEXT_MIN)
}

/**
 * Whether the next answer reloads the model because of the context: the model the chat uses is the one loaded now, and the
 * context asked for differs from the loaded one (the context cache is allocated when the model loads). A different model
 * reloads anyway, a stopped one loads anyway: no notice for those.
 */
export function contextChangeReloads(requested: number | null, status: LlmStatus | null, modelId: string | null): boolean {
  if (requested === null || !status || !modelId) return false
  const loaded = status.state === 'ready' || status.state === 'generating'
  return loaded && status.model_id === modelId && status.context_size !== null && status.context_size !== requested
}

/** What the status line says while the model loads: a reload for a new context, or a plain load. */
export function loadingLabel(requested: number | null, status: LlmStatus | null, modelId: string): { key: string; params: (string | number)[] } {
  if (requested !== null && contextChangeReloads(requested, status, modelId)) return { key: 'chat.status.reloadContext', params: [requested] }
  return { key: 'chat.status.loadingModel', params: [] }
}
