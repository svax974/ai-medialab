/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { EngineStatus } from '@/modules/hardware'

export interface EngineCardView {
  /** Colour of the status dot. */
  tone: 'warn' | 'safe' | 'ok' | 'idle'
  /** Whether the dot breathes. */
  pulse: boolean
  /** Locale key of the label when no model name applies (`name` is then null). */
  labelKey: string | null
  /** Name of the model to show (loaded or running), or null. */
  name: string | null
  detail: { key: string; params?: (string | number)[] } | { clockFrom: number } | null
  queued: number
  canUnload: boolean
}

/**
 * What the engine card shows: loading the model (with a clock), generating, ready (model in memory, quantization) or
 * nothing loaded; the number waiting (the generation queue of Nest, plus the jobs the engine itself still lists: the former
 * interface, counted once when in both); the unload button only when idle with a model.
 */
export function engineCardView(status: EngineStatus, modelName: string | null, modelKind: string | null, waiting: readonly string[] = []): EngineCardView {
  const queued = new Set([...waiting, ...status.queue]).size
  switch (status.state) {
    case 'loading':
      return { tone: 'warn', pulse: true, labelKey: 'thread.engine.loading', name: null, detail: status.load_started_at ? { clockFrom: status.load_started_at } : null, queued, canUnload: false }
    case 'busy':
      return {
        tone: 'safe',
        pulse: true,
        labelKey: modelName ? null : 'thread.engine.generating',
        name: modelName,
        detail: { key: modelKind === 'video' ? 'thread.engine.renderingVideo' : 'thread.engine.inProgress' },
        queued,
        canUnload: false,
      }
    case 'ready':
      return {
        tone: 'ok',
        pulse: false,
        labelKey: modelName || status.model_id ? null : 'thread.engine.ready',
        name: modelName ?? status.model_id,
        detail: status.quantize ? { key: 'thread.engine.inMemoryBits', params: [status.quantize] } : { key: 'thread.engine.inMemory' },
        queued,
        canUnload: true,
      }
    default:
      return { tone: 'idle', pulse: false, labelKey: 'thread.engine.none', name: null, detail: { key: 'thread.engine.onDemand' }, queued, canUnload: false }
  }
}
