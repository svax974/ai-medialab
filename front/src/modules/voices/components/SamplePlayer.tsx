/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import PauseRounded from '@mui/icons-material/PauseRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { Waveform, useSharedAudioPlayer } from '@/modules_shared/common/components/ui/media'
import { formatClock } from '@/modules_shared/common/components/ui/progress'

interface Props {
  /** Id on the shared player: a sound that starts stops the one playing elsewhere in the tab. */
  id: string
  url: string | null
  peaks: number[]
  duration: number
  /** `card`: the framed preview of the voice studio; `inline`: the row of a voice card. */
  variant?: 'card' | 'inline'
  /** Show the clock (the preview does; the voice card has no room). */
  clock?: boolean
}

const mono = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

/** Play/pause, a seekable waveform and (optionally) the clock for one sample, on the tab-wide shared player. */
export function SamplePlayer({ id, url, peaks, duration, variant = 'card', clock = true }: Props) {
  const player = useSharedAudioPlayer(id, url ?? '')
  if (!url) return null
  const total = duration || player.duration
  const card = variant === 'card'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ...(card ? { borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface-2) 60%, transparent)', px: 1.75, py: 1.5 } : {}) }}>
      <TipIconButton labelId={player.playing ? 'voices.player.pause' : 'voices.player.play'} tone="default" active={player.playing} onClick={player.toggle} sx={{ width: card ? 40 : 36, height: card ? 40 : 36, borderRadius: '50%', flexShrink: 0 }}>
        {player.playing ? <PauseRounded sx={{ fontSize: 18 }} /> : <PlayArrowRounded sx={{ fontSize: 18 }} />}
      </TipIconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Waveform peaks={peaks} progress={player.current && total ? player.time / total : 0} active={player.playing} onSeek={player.seek} height={card ? 44 : 36} />
      </Box>
      {clock && (
        <Box sx={{ ...mono, width: 76, flexShrink: 0, textAlign: 'right', fontSize: 11.5, color: 'var(--ink-2)' }}>
          {formatClock(player.current ? player.time : 0)}
          <Box component="span" sx={{ color: 'var(--faint)' }}> / {formatClock(total)}</Box>
        </Box>
      )}
    </Box>
  )
}
