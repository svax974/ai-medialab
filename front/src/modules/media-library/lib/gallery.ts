/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { AssetMedia } from '../types'

/** The search box waits this long after the last key before the list is queried again (as before). */
export const SEARCH_DELAY_MS = 250

/** The next page is requested when the end of the list is this close to the visible area (as before). */
export const PREFETCH_MARGIN = '600px'

/** Assets per page. */
export const PAGE_SIZE = 60

/** Cursor of the next page (`before` of the last page), `undefined` when the list ended. */
export function nextCursor(last: { next_before: number | null }): number | undefined {
  return last.next_before ?? undefined
}

/** Count shown in the header: the loaded items, with a `+` while more pages exist. */
export function countText(loaded: number, hasMore: boolean): string {
  return `${loaded}${hasMore ? '+' : ''}`
}

export type GalleryState = 'loading' | 'error' | 'empty' | 'ready'

export interface GalleryStateInput {
  isLoading: boolean
  isError: boolean
  itemCount: number
}

/** What the page shows: the spinner of the first load, an error with a retry, the empty message, or the grid. */
export function galleryState({ isLoading, isError, itemCount }: GalleryStateInput): GalleryState {
  if (itemCount > 0) return 'ready'
  if (isLoading) return 'loading'
  return isError ? 'error' : 'empty'
}

/** Locale key of the empty message: favorites filter, then a search, then nothing generated yet (same order as before). */
export function emptyKey(media: AssetMedia, favorites: boolean, search: string): string {
  if (favorites) return `library.${media}.emptyFavorites`
  return search ? 'library.emptySearch' : `library.${media}.empty`
}

/** Number of masonry columns by breakpoint (MUI `xs`, `sm`, `md`, `lg`, `xl`; the former Tailwind `md`, `xl` and `2xl` map to `md`, `lg` and `xl`) of each gallery; the video gallery is wider per tile. */
export const GALLERY_COLUMNS: Record<AssetMedia, { xs: number; sm: number; md: number; lg: number; xl: number }> = {
  image: { xs: 2, sm: 2, md: 3, lg: 4, xl: 5 },
  video: { xs: 1, sm: 2, md: 2, lg: 3, xl: 4 },
  audio: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
}
