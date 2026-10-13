/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded'
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useToggleFavorite } from '@/modules/studio-core'
import { downloadAsset } from '@/modules/studio-core/lib/clipboard'
import type { Asset } from '@/modules/studio-core'
import { useVideoInputs } from '../hooks/useVideoInputs'
import { assetRatio } from '../lib/clips'
import { pauseOthers } from '../lib/playback'

const glass = { backgroundColor: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' } }
const show = { opacity: 0, transition: 'opacity 0.15s', '.tile:hover &, &:focus-within': { opacity: 1 } }

/**
 * Actions on a clip, shown on hover at the top corners (so they never cover the player controls): favorite on the left; on
 * the right use as the video to edit, last frame as the start of the next clip, download, enlarge (when `onOpen` is given).
 * The parent carries the `tile` class.
 */
export function ClipActions({ asset, onOpen }: { asset: Asset; onOpen?: () => void }) {
  const toggle = useToggleFavorite()
  const { takeAsSource, continueFromLastFrame } = useVideoInputs()
  return (
    <>
      <Box sx={{ ...show, pointerEvents: 'none', position: 'absolute', inset: '0 0 auto 0', height: 64, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }} />
      <Box sx={{ ...show, position: 'absolute', right: 8, top: 8, display: 'flex', gap: '4px' }}>
        <TipIconButton labelId="videoStudio.clip.asSource" tone="default" size="small" onClick={() => takeAsSource(asset)} sx={glass}>
          <MovieOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
        <TipIconButton labelId="videoStudio.clip.lastFrame" tone="default" size="small" onClick={() => void continueFromLastFrame(asset)} sx={glass}>
          <SubdirectoryArrowRightRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
        <TipIconButton labelId="videoStudio.clip.download" tone="default" size="small" onClick={() => downloadAsset(asset)} sx={glass}>
          <FileDownloadOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
        {onOpen && (
          <TipIconButton labelId="thread.tile.enlarge" tone="default" size="small" onClick={onOpen} sx={glass}>
            <OpenInFullRounded sx={{ fontSize: 16 }} />
          </TipIconButton>
        )}
      </Box>
      <TipIconButton
        labelId={asset.favorite ? 'thread.tile.unfavorite' : 'thread.tile.favorite'}
        tone="default"
        size="small"
        onClick={() => toggle.mutate(asset)}
        sx={{ ...glass, position: 'absolute', left: 8, top: 8, width: 28, height: 28, ...(asset.favorite ? { color: 'var(--safe)', opacity: 1 } : show) }}
      >
        {asset.favorite ? <FavoriteRounded sx={{ fontSize: 16 }} /> : <FavoriteBorderRounded sx={{ fontSize: 16 }} />}
      </TipIconButton>
    </>
  )
}

/** A produced clip with the native player controls (poster, loop, metadata only until played) and its actions on hover. */
export function ClipTile({ asset, ratio, fresh, onOpen }: { asset: Asset; ratio: number; fresh: boolean; onOpen: () => void }) {
  return (
    <Box className="tile" sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', backgroundColor: 'var(--tray)', boxShadow: '0 0 0 1px var(--line)', aspectRatio: String(assetRatio(asset, ratio)) }}>
      <Box
        component="video"
        src={resolveMediaUrl(asset.url)}
        poster={resolveMediaUrl(asset.thumb_url)}
        controls
        loop
        playsInline
        preload="metadata"
        onPlay={(event: React.SyntheticEvent<HTMLVideoElement>) => pauseOthers(event.currentTarget)}
        sx={{ width: '100%', height: '100%', backgroundColor: '#000', objectFit: 'contain', ...(fresh ? { animation: 'var(--animate-develop)' } : {}) }}
      />
      <ClipActions asset={asset} onOpen={onOpen} />
    </Box>
  )
}

/** A clip still to come: a tray with a dot (breathing and shimmering while it is the one being computed), the label and a thin progress bar. */
export function PendingClip({ ratio, fraction, active, label }: { ratio: number; fraction: number; active: boolean; label: string }) {
  return (
    <Box className="cn-tray" sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', boxShadow: '0 0 0 1px var(--line)', aspectRatio: String(ratio) }}>
      {active && <Box className="cn-shimmer" sx={{ position: 'absolute', inset: 0 }} />}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: active ? 'var(--safe)' : 'color-mix(in oklab, var(--faint) 50%, transparent)', ...(active ? { boxShadow: '0 0 18px var(--safe)', animation: 'var(--animate-breathe)' } : {}) }} />
        <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{label}</Box>
      </Box>
      <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', height: 2, backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <Box sx={{ height: '100%', width: `${Math.max(active ? 2 : 0, fraction * 100)}%`, backgroundColor: 'var(--safe)', boxShadow: '0 0 12px var(--safe)', transition: 'width 0.5s' }} />
      </Box>
    </Box>
  )
}
