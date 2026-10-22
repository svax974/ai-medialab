/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState, type ReactNode } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useAssetPages } from '../hooks/useAssetPages'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useEndlessScroll } from '../hooks/useEndlessScroll'
import { countText, emptyKey, galleryState, GALLERY_COLUMNS, SEARCH_DELAY_MS } from '../lib/gallery'
import { useLightboxStore } from '../state/lightboxStore'
import type { Asset, AssetMedia } from '../types'
import { GalleryHeader } from './GalleryHeader'

export interface AssetGalleryProps {
  media: AssetMedia
  /** One tile; `open` shows the loaded assets in the viewer from this one (previous / next walk the loaded pages). */
  renderTile: (asset: Asset, index: number, open: () => void) => ReactNode
}

/**
 * The generic gallery of a media kind (image now; audio and video reuse it in H4.5 and H4.6): header with the text filter
 * and the favorites toggle, the generated assets newest first in masonry columns, the next page read when the end comes
 * near, and the states (loading, error with retry, empty message by filter). Tiles come from the caller.
 */
export function AssetGallery({ media, renderTile }: AssetGalleryProps) {
  const t = useT()
  const [favorites, setFavorites] = useState(false)
  const [text, setText] = useState('')
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY_MS)
  const pages = useAssetPages(media, favorites, search)
  const show = useLightboxStore((s) => s.show)
  const sentinel = useEndlessScroll<HTMLDivElement>(pages.hasMore && !pages.isFetchingMore, pages.fetchMore)
  const state = galleryState({ isLoading: pages.isLoading, isError: pages.isError, itemCount: pages.items.length })
  const columns = GALLERY_COLUMNS[media]

  return (
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
      <GalleryHeader media={media} count={countText(pages.items.length, pages.hasMore)} search={text} onSearch={setText} favorites={favorites} onFavorites={setFavorites} />
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2.5 }}>
        {state === 'loading' && (
          <Box sx={{ display: 'grid', height: 160, placeItems: 'center', color: 'var(--muted)' }}><CircularProgress size={20} color="inherit" /></Box>
        )}
        {state === 'error' && (
          <Box role="alert" sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 12, fontSize: 14, color: 'var(--faint)' }}>
            {t('library.error')}
            <Button size="small" variant="outlined" color="inherit" onClick={pages.retry}>{t('library.retry')}</Button>
          </Box>
        )}
        {state === 'empty' && <Box sx={{ py: 12, textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>{t(emptyKey(media, favorites, search))}</Box>}
        <Box sx={{ columnGap: '12px', columnCount: { xs: columns.xs, sm: columns.sm, md: columns.md, lg: columns.lg, xl: columns.xl } }}>
          {pages.items.map((asset, index) => (
            <Box key={asset.id} sx={{ mb: '12px', breakInside: 'avoid' }}>
              {renderTile(asset, index, () => show(pages.items, index))}
            </Box>
          ))}
        </Box>
        <Box ref={sentinel} sx={{ display: 'grid', height: 40, placeItems: 'center' }}>
          {pages.isFetchingMore && <CircularProgress size={16} color="inherit" sx={{ color: 'var(--muted)' }} />}
        </Box>
      </Box>
    </Box>
  )
}
