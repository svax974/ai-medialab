/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export { AssetGallery, type AssetGalleryProps } from './components/AssetGallery'
export { DropVeil } from './components/DropVeil'
export { GalleryHeader } from './components/GalleryHeader'
export { VideoPosterTile } from './components/VideoPosterTile'
export { useAssetPages, type AssetPagesResult } from './hooks/useAssetPages'
export { useDebouncedValue } from './hooks/useDebouncedValue'
export { useEndlessScroll } from './hooks/useEndlessScroll'
export { patchAssetInData, removeAssetFromData, flattenPages, type AssetListData } from './lib/assetCache'
export { assetKeys } from './lib/assetKeys'
export { AUDIO_ACCEPT, VIDEO_ACCEPT, DROP_ACCEPT, classifyDrop } from './lib/dropRules'
export { GALLERY_COLUMNS, PAGE_SIZE, countText, emptyKey, galleryState } from './lib/gallery'
export { assetsApi } from './services/assetsApi'
export { useLightboxStore } from './state/lightboxStore'
export type * from './types'
