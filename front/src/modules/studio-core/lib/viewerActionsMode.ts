/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { StudioMode } from '@/modules/studio-shell/types'
import type { Asset } from '../types'

/** The mode whose viewer actions apply to an asset: a clip always belongs to the video studio, anything else to the mode on screen. */
export function viewerActionsMode(asset: Pick<Asset, 'media'>, mode: StudioMode): StudioMode {
  return asset.media === 'video' ? 'video' : mode
}
