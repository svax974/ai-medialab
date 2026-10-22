/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { AssetGallery } from '@/modules/media-library'
import { ImageTile } from '@/modules/studio-core'
import { assetPrompt } from '@/modules/studio-core/lib/viewerDetails'

/** Tile width hint for the thumbnails: two columns on a phone, up to five on a wide screen. */
const SIZES = '(max-width: 900px) 50vw, 20vw'

/**
 * `/galerie`: every generated image, newest first (module `media-library`'s gallery with the image tile of `studio-core`:
 * favorite, use as reference, download, seed and prompt on hover; a click opens the viewer on the loaded images).
 */
export function ImageGallery() {
  return <AssetGallery media="image" renderTile={(asset, _index, open) => <ImageTile asset={asset} ratio={1} fresh={false} onOpen={open} caption={assetPrompt(asset)} sizes={SIZES} />} />
}
