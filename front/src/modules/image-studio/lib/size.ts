/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import { ratioOf } from '@/modules/studio-core/lib/messageState'
import type { GenParams } from '@/modules/studio-core/types'

/** Aspect ratios offered, with the locale key of their name ("Carré", "Portrait"...). */
export const ASPECTS = [
  { id: '1:1', labelKey: 'imageStudio.aspect.square' },
  { id: '4:5', labelKey: 'imageStudio.aspect.portrait' },
  { id: '3:4', labelKey: 'imageStudio.aspect.portrait' },
  { id: '2:3', labelKey: 'imageStudio.aspect.photo' },
  { id: '9:16', labelKey: 'imageStudio.aspect.story' },
  { id: '5:4', labelKey: 'imageStudio.aspect.landscape' },
  { id: '4:3', labelKey: 'imageStudio.aspect.landscape' },
  { id: '3:2', labelKey: 'imageStudio.aspect.photo' },
  { id: '16:9', labelKey: 'imageStudio.aspect.screen' },
  { id: '21:9', labelKey: 'imageStudio.aspect.cinema' },
] as const

/** Definitions (target megapixels). `0` ("Original") keeps the size of the reference image and needs one. */
export const QUALITIES = [
  { mp: 0, labelKey: 'imageStudio.quality.original', hintKey: 'imageStudio.quality.original.hint', needsReference: true },
  { mp: 0.5, labelKey: 'imageStudio.quality.draft', hintKey: 'imageStudio.quality.draft.hint', needsReference: false },
  { mp: 1, labelKey: 'imageStudio.quality.standard', hintKey: 'imageStudio.quality.standard.hint', needsReference: false },
  { mp: 1.6, labelKey: 'imageStudio.quality.high', hintKey: 'imageStudio.quality.high.hint', needsReference: false },
  { mp: 2.3, labelKey: 'imageStudio.quality.veryHigh', hintKey: 'imageStudio.quality.veryHigh.hint', needsReference: false },
] as const

/** Largest definition (megapixels) a reference image is kept at by "Original" (mirrors the engine, engine/app/media.py). */
export const NATIVE_MAX_MP = 1.6

type SizeLimits = Pick<ModelInfo, 'size_multiple' | 'min_side' | 'max_side' | 'default_megapixels'>

const snap = (value: number, multiple: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value / multiple) * multiple))

/**
 * Size of the image that will be generated, as the engine computes it (mirrors `resolve_size` of engine/app/media.py):
 * custom size snapped to the model's multiple and bounds; "auto" takes the ratio of the first reference (and, at the
 * "Original" definition, its size capped to `NATIVE_MAX_MP` and the model's maximum, or enlarged with its ratio up to the
 * model's minimum side); otherwise the aspect ratio at
 * the requested megapixels (0.1 to 4), shrunk to fit the maximum side.
 */
export function resolveSize(params: GenParams, model: SizeLimits, reference?: { width: number | null; height: number | null } | null): { width: number; height: number } {
  const { size_multiple: multiple, min_side: low, max_side: high } = model
  const aspect = params.aspect ?? '1:1'
  if (aspect === 'custom') return { width: snap(params.width ?? 1024, multiple, low, high), height: snap(params.height ?? 1024, multiple, low, high) }
  let ratio: number | null = null
  if (aspect === 'auto' && reference?.width && reference?.height) {
    if (!params.megapixels) {
      const { width: rw, height: rh } = reference as { width: number; height: number }
      const shrink = Math.min(1, high / Math.max(rw, rh), Math.sqrt((NATIVE_MAX_MP * 1024 * 1024) / (rw * rh)))
      // A reference smaller than the model's minimum is enlarged as a whole, so its ratio survives.
      const scale = Math.min(Math.max(shrink, low / Math.min(rw, rh)), high / Math.max(rw, rh))
      return { width: snap(rw * scale, multiple, low, high), height: snap(rh * scale, multiple, low, high) }
    }
    ratio = reference.width / reference.height
  }
  ratio ??= ratioOf(aspect) ?? 1
  const megapixels = Math.max(0.1, Math.min(4, params.megapixels ?? model.default_megapixels))
  const area = megapixels * 1024 * 1024
  let width = Math.sqrt(area * ratio)
  let height = width / ratio
  const scale = Math.min(1, high / Math.max(width, height))
  width *= scale
  height *= scale
  return { width: snap(width, multiple, low, high), height: snap(height, multiple, low, high) }
}

/** Definitions offered: "Original" only when the format follows a reference image (`auto`). */
export function visibleQualities(hasReference: boolean, aspect: string): readonly (typeof QUALITIES)[number][] {
  return QUALITIES.filter((quality) => !quality.needsReference || (hasReference && aspect === 'auto'))
}

/** Whether a definition is the selected one (tolerance for floats). */
export function isQualityActive(params: GenParams, model: Pick<ModelInfo, 'default_megapixels'>, megapixels: number): boolean {
  return Math.abs((params.megapixels ?? model.default_megapixels) - megapixels) < 0.01
}

/** Label of the aspect button: "Auto", "Custom" (by key) or the ratio itself. */
export function aspectLabel(aspect: string): { key: string } | { text: string } {
  if (aspect === 'auto') return { key: 'imageStudio.aspect.auto' }
  if (aspect === 'custom') return { key: 'imageStudio.aspect.custom' }
  return { text: aspect }
}
