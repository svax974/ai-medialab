/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelCatalog, ModelInfo, ModelKind } from '../types'
import { isTranscription } from './catalogFormat'

/** The server's default model id for a kind. */
export function defaultModelId(catalog: ModelCatalog, kind: ModelKind): string | null {
  if (kind === 'llm') return catalog.llm?.default_model_id ?? null
  if (kind === 'diagram') return catalog.diagram?.default_model_id ?? null
  if (kind === 'ocr') return catalog.ocr?.default_model_id ?? null
  return kind === 'audio' ? catalog.audio.default_model_id : kind === 'video' ? (catalog.video?.default_model_id ?? null) : catalog.default_model_id
}

/** The installed model with the most finished generations (`usage`: count per model id), if any was ever used. */
function mostUsed(models: ModelInfo[], usage: Record<string, number>): ModelInfo | undefined {
  const used = models.filter((m) => m.ready && (usage[m.id] ?? 0) > 0)
  return used.reduce<ModelInfo | undefined>((best, m) => (!best || usage[m.id] > usage[best.id] ? m : best), undefined)
}

/**
 * The model a composer uses: the user's choice if it still exists, else the installed model used the most (`usage`),
 * else the server default, else the first of the kind. Transcription models (Whisper, Qwen3-ASR) are not generation
 * models and are never offered.
 */
export function resolveActiveModel(catalog: ModelCatalog, kind: ModelKind, storedId: string | null, usage: Record<string, number> = {}): ModelInfo | undefined {
  const mine = catalog.models.filter((m) => m.kind === kind && !isTranscription(m))
  const defaultId = defaultModelId(catalog, kind)
  return mine.find((m) => m.id === storedId) ?? mostUsed(mine, usage) ?? mine.find((m) => m.id === defaultId) ?? mine[0]
}

/** The model to suggest on the welcome card: nothing is ready yet and the active model is the recommended one. */
export function welcomeModel(catalog: ModelCatalog, kind: ModelKind, active: ModelInfo | undefined): ModelInfo | null {
  const scope = kind === 'audio' ? catalog.audio : kind === 'video' ? catalog.video : kind === 'llm' ? catalog.llm
    : kind === 'diagram' ? catalog.diagram : kind === 'ocr' ? catalog.ocr : catalog
  if (!scope || scope.ready || !active || active.id !== scope.recommended_model_id) return null
  return active
}
