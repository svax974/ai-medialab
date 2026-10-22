/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import UploadRounded from '@mui/icons-material/UploadRounded'

/** Veil shown over the window while files are dragged onto it: a dashed card with a title and one line of explanation. */
export function DropVeil({ title, body }: { title: string; body: string }) {
  return (
    <Box sx={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 1400, display: 'grid', placeItems: 'center', backgroundColor: 'color-mix(in oklab, var(--bg) 70%, transparent)', backdropFilter: 'blur(4px)', animation: 'var(--animate-fade)' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, borderRadius: '24px', border: '2px dashed color-mix(in oklab, var(--safe) 60%, transparent)', backgroundColor: 'color-mix(in oklab, var(--surface) 80%, transparent)', px: 7, py: 5, boxShadow: '0 0 80px -20px var(--safe-glow)' }}>
        <UploadRounded sx={{ fontSize: 32, color: 'var(--safe)' }} />
        <Box sx={{ fontFamily: 'var(--font-display)', fontSize: 30, color: 'var(--ink)' }}>{title}</Box>
        <Box sx={{ fontSize: 14, color: 'var(--muted)' }}>{body}</Box>
      </Box>
    </Box>
  )
}
