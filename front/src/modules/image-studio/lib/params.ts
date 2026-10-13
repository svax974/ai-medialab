/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { GenParams } from '@/modules/studio-core/types'

/**
 * Parameters a generation will use: the model's defaults, then the user's saved choices. With references the default
 * definition is "Original" (0: keep the size of the source image) and the format follows the first reference (`auto`);
 * without, `auto` makes no sense and falls back to a square.
 */
export function effectiveParams(model: ModelInfo, stored: GenParams | undefined, hasRefs: boolean): GenParams {
  const defaults: GenParams = Object.fromEntries(model.params.map((p) => [p.key, p.default]))
  const merged: GenParams = { ...defaults, megapixels: model.default_megapixels, ...stored }
  if (hasRefs && stored?.megapixels === undefined) merged.megapixels = 0
  if (!merged.aspect || (merged.aspect === 'auto' && !hasRefs)) merged.aspect = hasRefs ? 'auto' : '1:1'
  return merged
}

/** Body `params` of a message: the effective parameters and the pinned seed (`null`: random). */
export function sendParams(params: GenParams, seed: number | null): GenParams {
  return { ...params, seed }
}
