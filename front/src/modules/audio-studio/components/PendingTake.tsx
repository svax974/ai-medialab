/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { WaveformPending } from '@/modules_shared/common/components/ui/media'
import { useT } from '@/modules/studio-shell/hooks/useT'

/** A take still to come: an animated waveform filling with the progress while it is computed ("N %"), or "waiting". */
export function PendingTake({ running, fraction }: { running: boolean; fraction: number }) {
  const t = useT()
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.75 }}>
        <Box sx={{ display: 'grid', width: 40, height: 40, flexShrink: 0, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--surface-3)', color: 'var(--faint)' }}>
          {running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowRounded sx={{ fontSize: 18, opacity: 0.5 }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}><WaveformPending fraction={fraction} active={running} height={48} /></Box>
        <Box sx={{ width: 76, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--faint)' }}>{running ? `${Math.round(fraction * 100)} %` : t('audioStudio.take.waiting')}</Box>
      </Box>
    </Box>
  )
}
