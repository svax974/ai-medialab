/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { ImageSize } from '@/modules/studio-core/state/imageDraftStore'
import type { GenParams } from '@/modules/studio-core/types'

/**
 * Parameters a generation will use: the model's defaults, then the user's saved choices. With references the default
 * definition is "Original" (0: keep the size of the source image) and the format follows the first reference (`auto`);
 * without, `auto` keeps the size of the last image made that way (`referenceSize`, sent as a custom size) or falls back to
 * a square.
 */
export function effectiveParams(model: ModelInfo, stored: GenParams | undefined, hasRefs: boolean, referenceSize?: ImageSize | null): GenParams {
  const defaults: GenParams = Object.fromEntries(model.params.map((p) => [p.key, p.default]))
  const merged: GenParams = { ...defaults, megapixels: model.default_megapixels, ...stored }
  if (hasRefs && stored?.megapixels === undefined) merged.megapixels = 0
  if (merged.aspect === 'auto' && !hasRefs && referenceSize) return { ...merged, aspect: 'custom', ...referenceSize }
  if (!merged.aspect || (merged.aspect === 'auto' && !hasRefs)) merged.aspect = hasRefs ? 'auto' : '1:1'
  return merged
}

/** Whether the parameters ask for exactly the remembered "Reference" size (shown as "Reference", not "Custom"). */
export function isReferenceSize(params: GenParams, referenceSize: ImageSize | null | undefined): boolean {
  return !!referenceSize && params.aspect === 'custom' && params.width === referenceSize.width && params.height === referenceSize.height
}

/** Body `params` of a message: the effective parameters and the pinned seed (`null`: random). */
export function sendParams(params: GenParams, seed: number | null): GenParams {
  return { ...params, seed }
}
