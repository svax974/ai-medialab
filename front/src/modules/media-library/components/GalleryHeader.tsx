/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase, InputAdornment, TextField } from '@mui/material'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import type { AssetMedia } from '../types'

export interface GalleryHeaderProps {
  media: AssetMedia
  /** Already formatted count (`12`, `60+`). */
  count: string
  search: string
  onSearch: (text: string) => void
  favorites: boolean
  onFavorites: (on: boolean) => void
}

/** Title, count, text filter and favorites toggle of a gallery (texts `library.<media>.*`). */
export function GalleryHeader({ media, count, search, onSearch, favorites, onFavorites }: GalleryHeaderProps) {
  const t = useT()
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)
  return (
    <Box component="header" sx={{ display: 'flex', height: 56, flexShrink: 0, alignItems: 'center', gap: 1.5, borderBottom: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', px: 2.5, pl: sidebarOpen ? 2.5 : 7 }}>
      <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 24, color: 'var(--ink)' }}>{t(`library.${media}.title`)}</Box>
      <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{t(`library.${media}.count`, [count])}</Box>
      <Box sx={{ flex: 1 }} />
      <TextField
        size="small"
        value={search}
        placeholder={t(`library.${media}.search`)}
        onChange={(event) => onSearch(event.target.value)}
        slotProps={{
          htmlInput: { 'aria-label': t(`library.${media}.search`) },
          input: { startAdornment: <InputAdornment position="start" sx={{ mr: 0.5 }}><SearchRounded sx={{ fontSize: 14, color: 'var(--faint)' }} /></InputAdornment> },
        }}
        sx={{ width: { xs: 160, sm: 224 } }}
      />
      <ButtonBase
        aria-pressed={favorites}
        onClick={() => onFavorites(!favorites)}
        sx={{ display: 'flex', height: 32, alignItems: 'center', gap: '6px', borderRadius: '8px', border: '1px solid', borderColor: favorites ? 'color-mix(in oklab, var(--safe) 50%, transparent)' : 'var(--line)', backgroundColor: favorites ? 'var(--safe-soft)' : 'transparent', px: 1.25, fontSize: 13, color: favorites ? 'var(--ink)' : 'var(--ink-2)', transition: 'border-color 0.15s', '&:hover': { borderColor: favorites ? undefined : 'var(--line-strong)' } }}
      >
        {favorites ? <FavoriteRounded sx={{ fontSize: 14, color: 'var(--safe)' }} /> : <FavoriteBorderRounded sx={{ fontSize: 14 }} />}
        {t('library.favorites')}
      </ButtonBase>
    </Box>
  )
}
