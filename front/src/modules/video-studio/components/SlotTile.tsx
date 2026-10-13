/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import type { ModelInfo } from '@/modules/model-catalog'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { HelpTooltip } from '@/modules/studio-core'
import type { Asset } from '@/modules/studio-core'
import { useVideoInputs } from '../hooks/useVideoInputs'
import { slotRole } from '../lib/composerRules'
import { setDropTarget } from '../lib/dropTarget'
import { SLOT_ACCEPT } from '../lib/slots'
import { slotHelp } from '../lib/videoHelp'
import { useVideoDraftStore } from '../state/videoDraftStore'
import type { VideoSlot, VideoUpload } from '../types'

const SIZE = 72

export function UploadingTile({ upload }: { upload: VideoUpload }) {
  const t = useT()
  return (
    <Box title={t('videoStudio.slot.uploading', [upload.name])} sx={{ position: 'relative', display: 'flex', width: SIZE, height: SIZE, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', overflow: 'hidden', borderRadius: '12px', backgroundColor: 'var(--tray)', boxShadow: '0 0 0 1px var(--line)' }}>
      <CircularProgress size={16} sx={{ color: 'var(--safe)' }} />
      <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-2)' }}>{Math.round(upload.progress * 100)} %</Box>
      <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', height: 2, backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <Box sx={{ height: '100%', width: `${upload.progress * 100}%`, backgroundColor: 'var(--safe)', transition: 'width 0.2s' }} />
      </Box>
    </Box>
  )
}

export function FilledTile({ slot, asset, label, short, unused, over, dragProps }: { slot: VideoSlot; asset: Asset; label: string; short: string; unused: boolean; over: boolean; dragProps: Record<string, unknown> }) {
  const t = useT()
  const setSlot = useVideoDraftStore((s) => s.setSlot)
  const show = useLightboxStore((s) => s.show)
  return (
    <Box className="slot" {...dragProps} sx={{ position: 'relative', flexShrink: 0, animation: 'var(--animate-rise)' }}>
      <Box component="button" type="button" onClick={() => show([asset], 0)} aria-label={t('videoStudio.slot.view', [label])} sx={{ display: 'block', width: SIZE, height: SIZE, overflow: 'hidden', borderRadius: '12px', border: 0, p: 0, boxShadow: over ? '0 0 0 2px var(--safe)' : '0 0 0 1px var(--line-strong)', ...(unused ? { opacity: 0.35, filter: 'grayscale(1)' } : {}) }}>
        <Box component="img" src={resolveMediaUrl(asset.thumb_url)} alt={asset.original_name ?? ''} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>
      <Box component="span" sx={{ pointerEvents: 'none', position: 'absolute', bottom: 4, left: 4, display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.65)', px: '6px', py: '1px', fontFamily: 'var(--font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)' }}>
        {slot === 'source' && <MovieOutlined sx={{ fontSize: 10 }} />}
        {unused ? t('videoStudio.slot.ignored') : short}
      </Box>
      <Box component="button" type="button" onClick={() => setSlot(slot, null)} aria-label={t('videoStudio.slot.remove', [label])} sx={{ position: 'absolute', right: -6, top: -6, display: 'grid', width: 20, height: 20, placeItems: 'center', borderRadius: '50%', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-3)', p: 0, color: 'var(--ink-2)', opacity: 0, transition: 'opacity 0.15s', '&:hover': { color: 'var(--ink)' }, '.slot:hover &, &:focus-visible': { opacity: 1 } }}>
        <CloseRounded sx={{ fontSize: 12 }} />
      </Box>
    </Box>
  )
}

function EmptyTile({ slot, model, label, short, required, over, dragProps }: { slot: VideoSlot; model: ModelInfo; label: string; short: string; required: boolean; over: boolean; dragProps: Record<string, unknown> }) {
  const t = useT()
  const { importFiles } = useVideoInputs()
  const picker = useRef<HTMLInputElement>(null)
  const Icon = slot === 'source' ? MovieOutlined : AddPhotoAlternateOutlined
  return (
    <>
      <HelpTooltip help={slotHelp(slot, model.video!, label, required, t)}>
        <ButtonBase onClick={() => picker.current?.click()} {...dragProps} aria-label={`${label} ${t(required ? 'videoStudio.slot.titleRequired' : 'videoStudio.slot.titleOptional')}`} sx={{ display: 'flex', width: SIZE, height: SIZE, flexShrink: 0, flexDirection: 'column', gap: '4px', borderRadius: '12px', border: '1px dashed', transition: 'border-color 0.15s, color 0.15s, background-color 0.15s', borderColor: over ? 'var(--safe)' : required ? 'color-mix(in oklab, var(--warn) 60%, transparent)' : 'var(--line-strong)', color: over ? 'var(--ink)' : required ? 'var(--warn)' : 'var(--muted)', backgroundColor: over ? 'var(--safe-soft)' : 'transparent', '&:hover': { borderColor: 'color-mix(in oklab, var(--safe) 60%, transparent)', color: 'var(--ink)' } }}>
          <Icon sx={{ fontSize: 16 }} />
          <Box component="span" sx={{ fontSize: 10, lineHeight: 1 }}>{short}</Box>
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, opacity: 0.7 }}>{t(required ? 'videoStudio.slot.required' : 'videoStudio.slot.optional')}</Box>
        </ButtonBase>
      </HelpTooltip>
      <input
        ref={picker}
        type="file"
        accept={SLOT_ACCEPT[slot]}
        hidden
        aria-label={label}
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []), slot)
          event.target.value = ''
        }}
      />
    </>
  )
}

/**
 * One input of the clip above the prompt: the start image, the end image or the source video. Empty: a dashed tile that says
 * what it is for (tooltip), whether it is required, and takes a file by click or by drop on it. Importing: a progress tile.
 * Filled: the thumbnail (opens the viewer), its role or "ignored" when the model does not use it, a remove button.
 */
export function SlotTile({ slot, model }: { slot: VideoSlot; model: ModelInfo }) {
  const t = useT()
  const asset = useVideoDraftStore((s) => s[slot])
  const upload = useVideoDraftStore((s) => s.uploads.find((candidate) => candidate.slot === slot))
  const hasSource = useVideoDraftStore((s) => s.source !== null)
  const [over, setOver] = useState(false)
  const role = slotRole(slot, model, hasSource)
  const label = t(role.labelKey)
  const short = t(role.shortKey)
  const dragProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setDropTarget(slot)
      setOver(true)
    },
    onDragLeave: () => {
      setOver(false)
      setDropTarget(undefined)
    },
    onDrop: () => setOver(false),
  }
  if (upload) return <UploadingTile upload={upload} />
  if (asset) return <FilledTile slot={slot} asset={asset} label={label} short={short} unused={role.unused} over={over} dragProps={dragProps} />
  return <EmptyTile slot={slot} model={model} label={label} short={short} required={role.required} over={over} dragProps={dragProps} />
}
