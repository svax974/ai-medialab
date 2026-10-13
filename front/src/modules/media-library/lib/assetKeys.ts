/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { AssetMedia } from '../types'

/**
 * Query keys of the lists of assets. The family prefix `['assets']` is what events invalidate; the gallery of a media
 * kind is `list(media, favorites, q)`, the strip of recent images of the home page is `recent(media)`.
 */
export const assetKeys = {
  all: ['assets'] as const,
  recent: (media: string) => ['assets', 'recent', media] as const,
  list: (media: AssetMedia, favorites: boolean, q: string) => ['assets', 'list', media, favorites, q] as const,
}
