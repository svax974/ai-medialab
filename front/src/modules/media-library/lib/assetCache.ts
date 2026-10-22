/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { InfiniteData } from '@tanstack/react-query'
import type { Asset, AssetPage } from '../types'

/** What a query of the `assets` family holds: one page (recent images) or the pages of an infinite list (gallery). */
export type AssetListData = AssetPage | InfiniteData<AssetPage, number | null>

const isInfinite = (data: AssetListData): data is InfiniteData<AssetPage, number | null> => 'pages' in data

function mapPages(data: AssetListData, update: (page: AssetPage) => AssetPage): AssetListData {
  return isInfinite(data) ? { ...data, pages: data.pages.map(update) } : update(data)
}

/** Replaces an asset wherever a cached list shows it (nothing changes for a list without it). */
export function patchAssetInData(data: AssetListData, asset: Asset): AssetListData {
  return mapPages(data, (page) => (page.items.some((a) => a.id === asset.id) ? { ...page, items: page.items.map((a) => (a.id === asset.id ? { ...a, ...asset } : a)) } : page))
}

/** Removes an asset from every page of a cached list. */
export function removeAssetFromData(data: AssetListData, id: string): AssetListData {
  return mapPages(data, (page) => (page.items.some((a) => a.id === id) ? { ...page, items: page.items.filter((a) => a.id !== id) } : page))
}

/** The assets of an infinite list in display order, without the duplicates a shifting cursor can bring. */
export function flattenPages(data: { pages: AssetPage[] } | undefined): Asset[] {
  const seen = new Set<string>()
  const items: Asset[] = []
  for (const page of data?.pages ?? []) {
    for (const asset of page.items) {
      if (!seen.has(asset.id)) {
        seen.add(asset.id)
        items.push(asset)
      }
    }
  }
  return items
}
