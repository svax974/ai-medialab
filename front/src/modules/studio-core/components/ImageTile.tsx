/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined'
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useToggleFavorite } from '../hooks/useAssetActions'
import { addAsReference } from '../lib/draftActions'
import { downloadAsset } from '../lib/clipboard'
import { assetPrompt } from '../lib/viewerDetails'
import { ShareButton } from './ShareButton'
import { ASSET_DRAG_TYPE } from '../lib/assetDrag'
import type { Asset } from '../types'

const glass = { backgroundColor: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' } }
const show = { opacity: 0, transition: 'opacity 0.15s', '.tile:hover &, &:focus-within': { opacity: 1 } }

/** Actions on a produced image, shown on hover: favorite, seed, use as reference, download, enlarge. */
export function TileActions({ asset, onOpen }: { asset: Asset; onOpen?: () => void }) {
  const toggle = useToggleFavorite()
  const t = useT()
  return (
    <>
      <Box sx={{ ...show, pointerEvents: 'none', position: 'absolute', inset: '0 0 auto 0', height: 64, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }} />
      <Box sx={{ ...show, position: 'absolute', right: 8, top: 8, display: 'flex', gap: '4px' }}>
        <TipIconButton labelId="thread.tile.useAsReference" tone="default" size="small" onClick={() => addAsReference(asset)} sx={glass}>
          <AddPhotoAlternateOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
        <TipIconButton labelId="thread.tile.download" tone="default" size="small" onClick={() => downloadAsset(asset)} sx={glass}>
          <FileDownloadOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
        <ShareButton asset={asset} tone="default" sx={glass} />
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
      {asset.seed != null && (
        <Box component="span" sx={{ ...show, pointerEvents: 'none', position: 'absolute', bottom: 8, left: 8, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.5)', px: '6px', py: '2px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)' }}>
          {t('thread.tile.seed', [asset.seed])}
        </Box>
      )}
    </>
  )
}

/**
 * A produced image: thumbnail (the full file for large screens), opens the viewer, draggable to the composer. In a gallery,
 * `caption` (the prompt) rises over the bottom of the tile on hover and `sizes` tells the browser how wide the tile is.
 */
export function ImageTile({ asset, ratio, fresh, onOpen, caption, sizes = '(max-width: 900px) 90vw, 640px' }: { asset: Asset; ratio: number; fresh: boolean; onOpen: () => void; caption?: string | null; sizes?: string }) {
  const t = useT()
  const thumb = resolveMediaUrl(asset.thumb_url)
  const full = resolveMediaUrl(asset.url)
  const actual = asset.width && asset.height ? asset.width / asset.height : ratio
  return (
    <Box className="tile" sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', backgroundColor: 'var(--tray)', boxShadow: '0 0 0 1px var(--line)', aspectRatio: String(actual) }}>
      <Box component="button" type="button" onClick={onOpen} aria-label={t('thread.tile.enlarge')} sx={{ position: 'absolute', inset: 0, border: 0, p: 0, background: 'none', cursor: 'zoom-in' }}>
        <Box
          component="img"
          src={thumb}
          srcSet={`${thumb} 640w, ${full} ${asset.width ?? 1024}w`}
          sizes={sizes}
          alt={assetPrompt(asset) ?? ''}
          loading="lazy"
          draggable
          onDragStart={(event) => event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset))}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', ...(fresh ? { animation: 'var(--animate-develop)' } : {}) }}
        />
      </Box>
      <TileActions asset={asset} onOpen={onOpen} />
      {caption && (
        <Box className="caption" sx={{ ...show, pointerEvents: 'none', position: 'absolute', inset: 'auto 0 0 0', background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)', px: 1.5, pb: 1.25, pt: 4 }}>
          <Box sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12, lineHeight: 1.35, color: 'rgba(255,255,255,0.9)' }}>{caption}</Box>
        </Box>
      )}
    </Box>
  )
}

/** A cell still being made: the preview blurs and tints less as the image forms; a thin bar shows the progress. */
export function DevelopingTile({ ratio, previewUrl, filter, fraction, active }: { ratio: number; previewUrl: string | null; filter: string; fraction: number; active: boolean }) {
  return (
    <Box className="cn-tray" sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', boxShadow: '0 0 0 1px var(--line)', aspectRatio: String(ratio) }}>
      {previewUrl && (
        <Box key={previewUrl} component="img" src={resolveMediaUrl(previewUrl)} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', animation: 'var(--animate-fade)', filter }} />
      )}
      {active && <Box className="cn-shimmer" sx={{ position: 'absolute', inset: 0 }} />}
      <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', height: 2, backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <Box sx={{ height: '100%', width: `${Math.max(active ? 2 : 0, fraction * 100)}%`, backgroundColor: 'var(--safe)', boxShadow: '0 0 12px var(--safe)', transition: 'width 0.5s' }} />
      </Box>
      {!previewUrl && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: active ? 'var(--safe)' : 'color-mix(in oklab, var(--faint) 50%, transparent)', ...(active ? { boxShadow: '0 0 18px var(--safe)', animation: 'var(--animate-breathe)' } : {}) }} />
        </Box>
      )}
    </Box>
  )
}
