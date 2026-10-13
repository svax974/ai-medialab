/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelCatalog, ModelInfo, ModelKind } from '../types'
import { isTranscription } from './catalogFormat'

/** The server's default model id for a kind. */
export function defaultModelId(catalog: ModelCatalog, kind: ModelKind): string | null {
  return kind === 'audio' ? catalog.audio.default_model_id : kind === 'video' ? (catalog.video?.default_model_id ?? null) : catalog.default_model_id
}

/**
 * The model a composer uses: the user's choice if it still exists, else the server default, else the first of the
 * kind. Transcription models (Whisper, Qwen3-ASR) are not generation models and are never offered.
 */
export function resolveActiveModel(catalog: ModelCatalog, kind: ModelKind, storedId: string | null): ModelInfo | undefined {
  const mine = catalog.models.filter((m) => m.kind === kind && !isTranscription(m))
  const defaultId = defaultModelId(catalog, kind)
  return mine.find((m) => m.id === storedId) ?? mine.find((m) => m.id === defaultId) ?? mine[0]
}

/** The model to suggest on the welcome card: nothing is ready yet and the active model is the recommended one. */
export function welcomeModel(catalog: ModelCatalog, kind: ModelKind, active: ModelInfo | undefined): ModelInfo | null {
  const scope = kind === 'audio' ? catalog.audio : kind === 'video' ? catalog.video : catalog
  if (!scope || scope.ready || !active || active.id !== scope.recommended_model_id) return null
  return active
}
