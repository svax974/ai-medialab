/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { AssetGallery, VideoPosterTile } from '@/modules/media-library'
import { ClipActions } from './ClipTile'

/**
 * `/video/bibliotheque`: every generated clip, newest first (the generic gallery of `media-library` with its video tile: poster at the
 * clip's ratio, muted preview on hover, duration badge, prompt on hover) carrying the actions of a clip: favorite, use as the video to
 * edit, last frame as the start, download. A click opens the viewer on the loaded clips.
 */
export function VideoGallery() {
  return (
    <AssetGallery
      media="video"
      renderTile={(asset, _index, open) => (
        <Box className="tile" sx={{ position: 'relative', animation: 'var(--animate-fade)' }}>
          <VideoPosterTile asset={asset} onOpen={open} overlay={<ClipActions asset={asset} />} />
        </Box>
      )}
    />
  )
}
