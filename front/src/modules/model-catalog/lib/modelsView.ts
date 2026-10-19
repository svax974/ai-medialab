/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo, ModelKind } from '../types'

/** Categories of the management list, in display order. */
export const MANAGE_KINDS: readonly ModelKind[] = ['llm', 'audio', 'image', 'video']

export interface ModelGroup {
  kind: ModelKind
  models: ModelInfo[]
}

/** On disk (fully or partly) first, then by name: what the user can delete comes first. */
function byStateThenName(a: ModelInfo, b: ModelInfo): number {
  const rank = (m: ModelInfo) => (m.install === 'installed' ? 0 : m.install === 'partial' ? 1 : 2)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

/** The catalogue grouped by category (chat, audio, image, video); a category with no model is left out. */
export function groupModelsByKind(models: ModelInfo[]): ModelGroup[] {
  return MANAGE_KINDS.map((kind) => ({ kind, models: models.filter((m) => m.kind === kind).sort(byStateThenName) })).filter((g) => g.models.length > 0)
}

/** Models that take space on the machine (installed or partly downloaded). */
export function onDisk(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.install !== 'missing')
}
