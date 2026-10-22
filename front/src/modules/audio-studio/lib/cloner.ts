/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'

const canClone = (model: ModelInfo | undefined): model is ModelInfo => !!model && model.kind === 'audio' && model.audio?.task === 'tts' && model.audio.clone !== 'none' && model.compatible

/** Models that can speak with a cloned voice on this machine: a ready one first, then the lightest to download. */
export function cloningModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter(canClone).sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0))
}

/** The model to write with a library voice: the one in use when it can clone, else the best cloning model; `undefined` when none can. */
export function modelForVoice(models: readonly ModelInfo[], active: ModelInfo | undefined): ModelInfo | undefined {
  return canClone(active) ? active : cloningModels(models)[0]
}

/** Whether the voice's language (when it has one) is one the model speaks, so the composer can switch to it. */
export function speaksLanguage(model: Pick<ModelInfo, 'audio'>, language: string | null): language is string {
  return !!language && !!model.audio?.languages.some((candidate) => candidate.code === language)
}
