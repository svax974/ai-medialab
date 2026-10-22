/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import DownloadRounded from '@mui/icons-material/DownloadRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import PauseRounded from '@mui/icons-material/PauseRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { Waveform, useSharedAudioPlayer } from '@/modules_shared/common/components/ui/media'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useToggleFavorite, type Asset } from '@/modules/studio-core'
import { downloadTake } from '../hooks/useTakeActions'
import { isFreshTake, markerPosition, speakerColors, takeLabel, takeMeta, type TakeLabelPart } from '../lib/takes'
import { RateMenu } from './RateMenu'
import { TakeMenu } from './TakeMenu'

const mono = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

/** The line under the player: "take N", the voice and the seed, with the unit words translated. */
function useTakeLabel(parts: TakeLabelPart[]): string {
  const t = useT()
  return parts.map((part) => (part.kind === 'take' ? t('audioStudio.take.number', [part.number]) : part.kind === 'voice' ? part.name : t('audioStudio.take.seed', [part.seed]))).join(' · ')
}

/** Characters of a dialogue on the timeline: a coloured label at each place a character starts, a click jumps there. */
function Markers({ markers, duration, onSeek }: { markers: ReturnType<typeof takeMeta>['markers']; duration: number; onSeek: (fraction: number) => void }) {
  const colors = speakerColors(markers.map((marker) => marker.label))
  return (
    <Box sx={{ position: 'relative', mx: '14px', mb: '4px', ml: '66px', mr: '102px', height: 20 }}>
      {markers.map((marker, index) => (
        <Box key={index} component="button" type="button" onClick={() => onSeek(marker.start / duration)} sx={{ position: 'absolute', top: 0, left: `${markerPosition(marker.start, duration)}%`, display: 'flex', alignItems: 'center', gap: '4px', transform: 'translateX(-1px)', border: 0, borderLeft: '2px solid currentColor', background: 'none', pl: '6px', py: 0, fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors[marker.label], opacity: 0.9, '&:hover': { opacity: 1 } }}>
          {marker.label}
        </Box>
      ))}
    </Box>
  )
}

/**
 * One take: play/pause on the tab-wide player, a seekable waveform, the clock, the characters of a dialogue on a timeline,
 * then the label (take N · voice · seed), playback speed, favorite, download (WAV) and the "more" menu. A take produced
 * a moment ago is revealed with the "develop" animation. `compact` is the shorter variant of the home page.
 */
export function TakeCard({ asset, index = 0, total = 1, compact = false }: { asset: Asset; index?: number; total?: number; compact?: boolean }) {
  const player = useSharedAudioPlayer(asset.id, resolveMediaUrl(asset.url))
  const favorite = useToggleFavorite()
  const meta = takeMeta(asset)
  const duration = asset.duration ?? player.duration
  const label = useTakeLabel(takeLabel(asset, index, total))
  const progress = player.current && duration ? Math.min(1, player.time / duration) : 0
  return (
    <Box className="take" sx={{ borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', ...(isFreshTake(asset, Date.now() / 1000) ? { animation: 'var(--animate-develop)' } : {}) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, pb: 1, pt: 1.5 }}>
        <TipIconButton labelId={player.playing ? 'audioStudio.take.pause' : 'audioStudio.take.play'} tone="default" active={player.playing} onClick={player.toggle} sx={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, ...(player.playing ? { backgroundColor: 'var(--safe)', color: 'var(--safe-ink)', boxShadow: '0 0 22px -4px var(--safe-glow)' } : {}) }}>
          {player.playing ? <PauseRounded sx={{ fontSize: 18 }} /> : <PlayArrowRounded sx={{ fontSize: 18 }} />}
        </TipIconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Waveform peaks={meta.peaks} progress={progress} active={player.playing} onSeek={player.seek} height={compact ? 36 : 48} />
        </Box>
        <Box sx={{ ...mono, width: 76, flexShrink: 0, textAlign: 'right', fontSize: 11.5, color: 'var(--ink-2)' }}>
          {formatClock(player.current ? player.time : 0)}
          <Box component="span" sx={{ color: 'var(--faint)' }}> / {formatClock(duration)}</Box>
        </Box>
      </Box>
      {meta.markers.length > 1 && duration > 0 && <Markers markers={meta.markers} duration={duration} onSeek={player.seek} />}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', px: 1.25, pb: 1.25, pt: '2px' }}>
        <Box component="span" sx={{ ...mono, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pl: '4px', fontSize: 10.5, color: 'var(--faint)' }}>{label}</Box>
        <RateMenu rate={player.rate} onChange={player.setRate} />
        <TipIconButton labelId={asset.favorite ? 'thread.tile.unfavorite' : 'thread.tile.favorite'} size="small" active={asset.favorite} disabled={favorite.isPending} onClick={() => favorite.mutate(asset)} sx={{ width: 28, height: 28 }}>
          {asset.favorite ? <FavoriteRounded sx={{ fontSize: 14, color: 'var(--safe)' }} /> : <FavoriteBorderRounded sx={{ fontSize: 14 }} />}
        </TipIconButton>
        <TipIconButton labelId="audioStudio.take.download" size="small" onClick={() => downloadTake(asset)} sx={{ width: 28, height: 28 }}>
          <DownloadRounded sx={{ fontSize: 14 }} />
        </TipIconButton>
        <TakeMenu asset={asset} />
      </Box>
    </Box>
  )
}
