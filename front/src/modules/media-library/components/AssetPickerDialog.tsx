/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, TextField, ToggleButton } from '@mui/material'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useAssetPages } from '../hooks/useAssetPages'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useEndlessScroll } from '../hooks/useEndlessScroll'
import { SEARCH_DELAY_MS } from '../lib/gallery'
import type { Asset } from '../types'

export interface AssetPickerDialogProps {
  open: boolean
  onClose: () => void
  /** The chosen images, in the order they were picked. */
  onPick: (assets: Asset[]) => void
  /** Several images can be ticked (then confirmed); otherwise a click picks the image and closes. */
  multiple?: boolean
}

/**
 * Picks among the generated images of the library, to use them as references or inputs: text filter, favorites only,
 * the newest first, the next pages read when the end comes near.
 */
export function AssetPickerDialog({ open, onClose, onPick, multiple = false }: AssetPickerDialogProps) {
  const t = useT()
  const [text, setText] = useState('')
  const [favorites, setFavorites] = useState(false)
  const [chosen, setChosen] = useState<Asset[]>([])
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY_MS)
  const pages = useAssetPages('image', favorites, search)
  const sentinel = useEndlessScroll<HTMLDivElement>(pages.hasMore && !pages.isFetchingMore, pages.fetchMore)

  useEffect(() => {
    if (!open) setChosen([])
  }, [open])

  const finish = (assets: Asset[]) => {
    onPick(assets)
    onClose()
  }
  const toggle = (asset: Asset) => {
    if (!multiple) return finish([asset])
    setChosen((current) => (current.some((a) => a.id === asset.id) ? current.filter((a) => a.id !== asset.id) : [...current, asset]))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="asset-picker-title">
      <DialogTitle id="asset-picker-title" sx={{ pb: 1 }}>{t('library.picker.title')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, alignContent: 'start', minHeight: 360 }}>
        <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
          <TextField
            size="small" fullWidth value={text} onChange={(event) => setText(event.target.value)} placeholder={t('library.picker.search')}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18 }} /></InputAdornment> } }}
          />
          <ToggleButton value="favorites" size="small" selected={favorites} onChange={() => setFavorites((on) => !on)} aria-label={t('library.picker.favorites')} sx={{ px: 1.5, gap: 0.75, textTransform: 'none', whiteSpace: 'nowrap' }}>
            <FavoriteBorderRounded sx={{ fontSize: 16 }} />
            {t('library.picker.favorites')}
          </ToggleButton>
        </Box>
        {pages.isLoading && <Box sx={{ display: 'grid', height: 160, placeItems: 'center', color: 'var(--muted)' }}><CircularProgress size={20} color="inherit" /></Box>}
        {pages.isError && (
          <Box role="alert" sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 6, fontSize: 14, color: 'var(--faint)' }}>
            {t('library.error')}
            <Button size="small" variant="outlined" color="inherit" onClick={pages.retry}>{t('library.retry')}</Button>
          </Box>
        )}
        {!pages.isLoading && !pages.isError && pages.items.length === 0 && <Box sx={{ py: 8, textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>{t('library.picker.empty')}</Box>}
        <Box sx={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
          {pages.items.map((asset) => {
            const rank = chosen.findIndex((a) => a.id === asset.id)
            return (
              <Box
                key={asset.id} component="button" type="button" onClick={() => toggle(asset)} aria-pressed={rank >= 0}
                aria-label={asset.prompt || asset.original_name || asset.id}
                sx={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', borderRadius: '10px', border: '2px solid', borderColor: rank >= 0 ? 'var(--safe)' : 'transparent', p: 0, cursor: 'pointer', backgroundColor: 'var(--surface-2)', '&:hover': { borderColor: rank >= 0 ? 'var(--safe)' : 'var(--line-strong)' } }}
              >
                <Box component="img" src={resolveMediaUrl(asset.thumb_url)} alt="" loading="lazy" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                {rank >= 0 && (
                  <Box sx={{ position: 'absolute', right: 4, top: 4, display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '10px', backgroundColor: 'var(--safe)', color: '#000', px: '6px', fontSize: 11, fontWeight: 600 }}>
                    <CheckCircleRounded sx={{ fontSize: 12 }} />{rank + 1}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        <Box ref={sentinel} sx={{ display: 'grid', height: 24, placeItems: 'center' }}>
          {pages.isFetchingMore && <CircularProgress size={16} color="inherit" />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>{t('library.picker.cancel')}</Button>
        {multiple && <Button variant="contained" disabled={chosen.length === 0} onClick={() => finish(chosen)}>{t('library.picker.confirm', [chosen.length])}</Button>}
      </DialogActions>
    </Dialog>
  )
}
