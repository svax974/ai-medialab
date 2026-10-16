/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import type { VideoCaps } from '@/modules/model-catalog'
import type { ChatGeneration, ChatSettings, CreationKind, CreationModels } from '../types'

/** The commands of the composer (`/image`, `/video`, `/audio`): they start a generation without the language model. */
export const CREATION_COMMANDS = ['image', 'video', 'audio'] as const

/** The commands whose name starts with what is typed after the slash, while that is the only word of the draft (`/vi` → video). */
export function commandsFor(draft: string): CreationKind[] {
  const typed = /^\/([a-z]*)$/i.exec(draft.trimStart())
  return typed ? CREATION_COMMANDS.filter((name) => name.startsWith(typed[1].toLowerCase())) : []
}

/** What the card of a generation shows: waiting for a choice, queued, running, done, failed or stopped. */
export type GenerationView = 'pending' | 'waiting' | 'running' | 'done' | 'failed' | 'stopped'

export function generationView(generation: Pick<ChatGeneration, 'state'>): GenerationView {
  switch (generation.state) {
    case 'pending': return 'pending'
    case 'queued': return 'waiting'
    case 'loading':
    case 'running': return 'running'
    case 'done': return 'done'
    case 'error': return 'failed'
    default: return 'stopped'
  }
}

/** The model each studio would use (only those that are ready), as a send tells the server: absent kinds get no tool. */
export function creationModels(models: Partial<Record<CreationKind, { id: string; ready: boolean } | undefined>>): CreationModels {
  const out: CreationModels = {}
  for (const kind of CREATION_COMMANDS) {
    const model = models[kind]
    if (model?.ready) out[kind] = model.id
  }
  return out
}

/** `creation_models` for a request, when the creation tools are on for the conversation and at least one studio has a ready model. */
export function withCreation(settings: Pick<ChatSettings, 'tools'> | null, models: CreationModels): { creation_models?: CreationModels } {
  return settings?.tools.creation && Object.keys(models).length > 0 ? { creation_models: models } : {}
}

export interface DurationBounds {
  min: number
  max: number
  step: number
  initial: number
}

/** Bounds of the duration slider of a video card: the model's, with the default inside them. */
export function durationBounds(caps: Pick<VideoCaps, 'min_seconds' | 'max_seconds' | 'default_seconds'> | null | undefined): DurationBounds {
  const max = caps?.max_seconds ?? 5
  const min = Math.min(caps?.min_seconds ?? 1, max)
  const wanted = caps?.default_seconds ?? 5
  return { min, max: Math.max(max, min + 0.5), step: 0.5, initial: Math.min(max, Math.max(min, wanted)) }
}
