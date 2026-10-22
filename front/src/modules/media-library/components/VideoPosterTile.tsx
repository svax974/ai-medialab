/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { VideoPoster } from '@/modules_shared/common/components/ui/media'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '../types'

/**
 * A generated clip as a gallery tile (common `VideoPoster`: poster at the real ratio, muted preview on hover, duration
 * badge, prompt on hover). `overlay` carries the caller's buttons (favorite, download...); H4.6 supplies them.
 */
export function VideoPosterTile({ asset, onOpen, overlay }: { asset: Asset; onOpen: () => void; overlay?: ReactNode }) {
  return (
    <VideoPoster
      src={resolveMediaUrl(asset.url)}
      poster={resolveMediaUrl(asset.thumb_url)}
      width={asset.width}
      height={asset.height}
      durationSeconds={asset.duration}
      caption={asset.prompt}
      alt={asset.prompt ?? ''}
      onOpen={onOpen}
      overlay={overlay}
    />
  )
}
