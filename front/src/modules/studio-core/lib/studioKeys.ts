/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Query key of the lists of assets (generated images of the home page; the gallery of H4.4 uses the same family). */
export const assetKeys = {
  all: ['assets'] as const,
  recent: (media: string) => ['assets', 'recent', media] as const,
}
