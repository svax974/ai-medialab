/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { JobProgress, Message } from '@/modules/studio-core'
import { languageLabel } from './takes'
import type { AudioCaps } from '@/modules/model-catalog'

/** What the line next to the model name says for an audio message. The component turns each kind into text. */
export type AudioStatus =
  | { kind: 'queued'; position: number | null }
  | { kind: 'loading'; elapsed: number }
  | { kind: 'running'; pass: number | null; total: number | null; take: number | null; eta: number | null }
  | { kind: 'meta'; language: string | null; duration: number | null; createdAt: number }

export function audioStatus(
  message: Message,
  progress: JobProgress | undefined,
  context: { now: number; queueIndex: number; caps: AudioCaps | null | undefined },
): AudioStatus {
  const count = message.params.count ?? 1
  if (message.status === 'queued') return { kind: 'queued', position: context.queueIndex > 0 ? context.queueIndex + 1 : null }
  if (message.status === 'loading') return { kind: 'loading', elapsed: context.now - (progress?.load_started_at ?? message.started_at ?? context.now) }
  if (message.status === 'running') {
    return {
      kind: 'running',
      pass: progress?.step ? progress.step : null,
      total: progress?.total ?? null,
      take: count > 1 ? (progress?.index ?? 0) + 1 : null,
      eta: progress?.eta != null && progress.step ? progress.eta : null,
    }
  }
  return {
    kind: 'meta',
    language: languageLabel(context.caps, message.params['language']),
    duration: message.status === 'done' && message.finished_at && message.started_at ? message.finished_at - message.started_at : null,
    createdAt: message.created_at,
  }
}
