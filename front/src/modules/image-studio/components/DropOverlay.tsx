/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import UploadRounded from '@mui/icons-material/UploadRounded'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useImageDrop } from '../hooks/useImageDrop'

/** Veil shown while images are dragged over the window (mounted once by the shell in image mode); the drop itself is `useImageDrop`. */
export function ImageDropLayer() {
  const t = useT()
  const dragging = useImageDrop(true)
  if (!dragging) return null
  return (
    <Box sx={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 1400, display: 'grid', placeItems: 'center', backgroundColor: 'color-mix(in oklab, var(--bg) 70%, transparent)', backdropFilter: 'blur(4px)', animation: 'var(--animate-fade)' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, borderRadius: '24px', border: '2px dashed color-mix(in oklab, var(--safe) 60%, transparent)', backgroundColor: 'color-mix(in oklab, var(--surface) 80%, transparent)', px: 7, py: 5, boxShadow: '0 0 80px -20px var(--safe-glow)' }}>
        <UploadRounded sx={{ fontSize: 32, color: 'var(--safe)' }} />
        <Box sx={{ fontFamily: 'var(--font-display)', fontSize: 30, color: 'var(--ink)' }}>{t('imageStudio.drop.title')}</Box>
        <Box sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('imageStudio.drop.body')}</Box>
      </Box>
    </Box>
  )
}
