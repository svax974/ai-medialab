/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { recordingHint } from '../lib/recording'

/** While recording: a level meter around the mic, the elapsed time with a hint on the length, "Finish", and the text to read. */
export function RecordingPanel({ seconds, level, onStop, script }: { seconds: number; level: number; onStop: () => void; script: string }) {
  const t = useT()
  const hint = recordingHint(seconds)
  return (
    <Box sx={{ borderRadius: '16px', border: '1px solid color-mix(in oklab, var(--safe) 40%, transparent)', backgroundColor: 'var(--safe-soft)', p: 2 }}>
      <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box component="span" sx={{ position: 'relative', display: 'grid', width: 48, height: 48, flexShrink: 0, placeItems: 'center' }}>
          <Box component="span" sx={{ position: 'absolute', inset: 0, borderRadius: '50%', backgroundColor: 'color-mix(in oklab, var(--safe) 30%, transparent)', transform: `scale(${1 + level * 0.9})`, transition: 'transform 80ms linear' }} />
          <Box component="span" sx={{ position: 'relative', display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--safe)', color: 'var(--safe-ink)' }}><MicRounded sx={{ fontSize: 16 }} /></Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('voices.recording.title')}</Box>
          <Box sx={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
            {formatClock(seconds)}
            {hint ? ` · ${t(hint)}` : ''}
          </Box>
        </Box>
        <Button variant="contained" onClick={onStop} startIcon={<StopRounded sx={{ fontSize: 14 }} />}>{t('voices.recording.stop')}</Button>
      </Box>
      <Box className="cn-eyebrow" sx={{ mb: '6px' }}>{t('voices.recording.read')}</Box>
      <Box component="p" sx={{ m: 0, borderRadius: '12px', backgroundColor: 'color-mix(in oklab, var(--surface) 70%, transparent)', p: 1.5, fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>{script}</Box>
    </Box>
  )
}
