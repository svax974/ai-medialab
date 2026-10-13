/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { assetsApi } from '../services/assetsApi'
import { assetKeys } from '../lib/assetKeys'
import { flattenPages } from '../lib/assetCache'
import { nextCursor, PAGE_SIZE } from '../lib/gallery'
import type { Asset, AssetMedia } from '../types'

export interface AssetPagesResult {
  items: Asset[]
  hasMore: boolean
  isLoading: boolean
  isError: boolean
  isFetchingMore: boolean
  fetchMore: () => void
  retry: () => void
}

/**
 * The generated assets of a media kind, newest first, page by page (cursor `next_before`), filtered by favorites and by a
 * text search (prompt or conversation title, on the server). Always re-read when the page mounts (`staleTime: 0`): a
 * list left in the cache must show what was generated or favorited since; the `studio.asset.*` events keep it current
 * while it is shown (see `useStudioEvents`).
 */
export function useAssetPages(media: AssetMedia, favorites: boolean, search: string): AssetPagesResult {
  const query = useInfiniteQuery({
    queryKey: assetKeys.list(media, favorites, search),
    queryFn: ({ pageParam }) => assetsApi.list({ media, favorites, q: search, before: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as number | null,
    getNextPageParam: nextCursor,
    staleTime: 0,
  })
  return {
    items: flattenPages(query.data),
    hasMore: query.hasNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetchingMore: query.isFetchingNextPage,
    fetchMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  }
}
