/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { formatDuration } from '@/modules_shared/common/components/ui/progress'
import type { Help } from '@/modules_shared/common/components/ui/help'
import { formatDay, formatSeconds, formatTime } from './format'
import { PARAM_HELP, type Translator } from './paramHelp'
import type { Asset } from '../types'

export interface DetailRow {
  /** Locale key of the row label. */
  labelKey: string
  value: string
  mono: boolean
  copyable?: boolean
  help?: Help
}

interface Meta {
  prompt?: string
  model_id?: string
  steps?: number
  guidance?: number
  strength?: number
  seconds?: number
}

/** Prompt of an asset (stored in its meta, or the gallery's joined field). */
export function assetPrompt(asset: Pick<Asset, 'meta' | 'prompt'>): string | null {
  return (asset.meta as Meta)?.prompt ?? asset.prompt ?? null
}

/** Model id of an asset (its meta first, then the gallery's joined field). */
export function assetModelId(asset: Pick<Asset, 'meta' | 'model_id'>): string | null {
  return (asset.meta as Meta)?.model_id ?? asset.model_id ?? null
}

/** The "Details" list of the viewer: model, file, length, size, seed, steps, guidance, strength, date (only what the asset has). */
export function viewerDetails(asset: Asset, context: { modelName: string | null; t: Translator; lang: string }): DetailRow[] {
  const { modelName, t, lang } = context
  const meta = asset.meta as Meta
  const video = asset.media === 'video'
  const rows: (DetailRow | null)[] = [
    modelName ? { labelKey: 'thread.viewer.model', value: modelName, mono: false } : null,
    asset.kind === 'upload' ? { labelKey: 'thread.viewer.file', value: asset.original_name ?? t(video ? 'thread.viewer.importedVideo' : 'thread.viewer.importedImage'), mono: false } : null,
    video && asset.duration != null ? { labelKey: 'thread.viewer.length', value: formatSeconds(asset.duration, lang), mono: true } : null,
    video && asset.fps ? { labelKey: 'thread.viewer.fps', value: t('thread.viewer.fpsValue', [asset.fps]), mono: true } : null,
    asset.width ? { labelKey: 'thread.viewer.size', value: `${asset.width} × ${asset.height} px`, mono: true } : null,
    asset.seed != null ? { labelKey: 'thread.viewer.seed', value: String(asset.seed), mono: true, copyable: true, help: PARAM_HELP['seed'] } : null,
    meta.steps ? { labelKey: 'thread.viewer.steps', value: String(meta.steps), mono: true, help: PARAM_HELP['steps'] } : null,
    meta.guidance != null ? { labelKey: 'thread.viewer.guidance', value: String(meta.guidance), mono: true, help: PARAM_HELP['guidance'] } : null,
    meta.strength != null ? { labelKey: 'thread.viewer.strength', value: String(meta.strength), mono: true, help: PARAM_HELP[video ? 'strength_video' : 'strength'] } : null,
    meta.seconds && !video ? { labelKey: 'thread.viewer.computeTime', value: formatDuration(meta.seconds, lang), mono: true } : null,
    { labelKey: 'thread.viewer.date', value: `${formatDay(asset.created_at, lang)}, ${formatTime(asset.created_at, lang)}`, mono: false },
  ]
  return rows.filter((row): row is DetailRow => row !== null)
}
