/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo, VideoCaps, VideoResolution } from '@/modules/model-catalog'
import { ratioOf } from '@/modules/studio-core/lib/messageState'
import type { GenParams } from '@/modules/studio-core/types'

/** The formats of a clip; `labelKey` names the shape (screen, vertical, square...). */
export const VIDEO_ASPECTS = [
  { id: '16:9', labelKey: 'videoStudio.aspect.screen' },
  { id: '9:16', labelKey: 'videoStudio.aspect.vertical' },
  { id: '1:1', labelKey: 'videoStudio.aspect.square' },
  { id: '4:3', labelKey: 'videoStudio.aspect.landscape' },
  { id: '3:4', labelKey: 'videoStudio.aspect.portrait' },
] as const

/** Number of frames the model will actually render for a requested duration (`n * step + 1`). */
export function frameCount(seconds: number, caps: Pick<VideoCaps, 'fps' | 'frame_step'>): number {
  const step = Math.max(1, caps.frame_step)
  const n = Math.max(1, Math.round((seconds * caps.fps - 1) / step))
  return n * step + 1
}

/** Approximate output size for a format at a definition (the area of the model's native size, sides multiple of 16). `null` without a definition. */
export function videoSize(aspect: string, res: Pick<VideoResolution, 'short_side' | 'long_side'> | undefined): { width: number; height: number } | null {
  if (!res) return null
  const ratio = ratioOf(aspect) ?? 16 / 9
  const area = res.short_side * res.long_side
  const snap = (value: number) => Math.max(16, Math.round(value / 16) * 16)
  const width = Math.sqrt(area * ratio)
  return { width: snap(width), height: snap(width / ratio) }
}

/** Effective parameters: the model's defaults, the video ones (format, definition, duration), then the saved choices clamped to the model's limits. */
export function effectiveVideoParams(model: Pick<ModelInfo, 'params'> & { video?: VideoCaps | null }, stored: GenParams | undefined): GenParams {
  const caps = model.video as VideoCaps
  const defaults: GenParams = Object.fromEntries(model.params.map((spec) => [spec.key, spec.default]))
  const merged: GenParams = { ...defaults, aspect: '16:9', resolution: caps.default_resolution, seconds: caps.default_seconds, ...stored }
  const seconds = Number(merged['seconds'])
  merged['seconds'] = Math.min(caps.max_seconds, Math.max(caps.min_seconds, Number.isFinite(seconds) ? seconds : caps.default_seconds))
  if (!caps.resolutions.some((res) => res.id === merged['resolution'])) merged['resolution'] = caps.default_resolution
  if (!VIDEO_ASPECTS.some((aspect) => aspect.id === merged.aspect)) merged.aspect = '16:9'
  return merged
}
