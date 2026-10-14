/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState, type DragEvent } from 'react'
import { Box, CircularProgress } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import FirstPageRounded from '@mui/icons-material/FirstPageRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { HelpTooltip } from '@/modules/studio-core'
import type { Asset } from '@/modules/studio-core'
import type { PendingUpload } from '@/modules/studio-core/state/imageDraftStore'
import { referenceRole } from '../lib/composerRules'

const SIZE = 72
/** Drag type of a reference moved inside the strip: neither a file nor an asset, so the window drop zones ignore it. */
const REORDER_TYPE = 'application/x-cn-ref-order'

interface ThumbProps {
  asset: Asset
  model: ModelInfo
  index: number
  dropTarget: boolean
  onRemove: () => void
  onMoveFirst: () => void
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
  onDragEnd: () => void
}

function RefThumb({ asset, model, index, dropTarget, onRemove, onMoveFirst, onDragStart, onDragOver, onDrop, onDragEnd }: ThumbProps) {
  const t = useT()
  const role = referenceRole(model, index)
  const corner = { position: 'absolute', width: 20, height: 20, border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-3)', opacity: 0, transition: 'opacity 0.15s', '.ref:hover &, &:focus-visible': { opacity: 1 } }
  return (
    <Box className="ref" draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} sx={{ position: 'relative', flexShrink: 0, cursor: 'grab', animation: 'var(--animate-rise)' }}>
      <Box sx={{ width: SIZE, height: SIZE, overflow: 'hidden', borderRadius: '12px', boxShadow: dropTarget ? '0 0 0 2px var(--safe)' : '0 0 0 1px var(--line-strong)', transition: 'box-shadow 0.15s', ...(role.ignored ? { opacity: 0.35, filter: 'grayscale(1)' } : {}) }}>
        <Box component="img" draggable={false} src={resolveMediaUrl(asset.thumb_url)} alt={asset.original_name ?? ''} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>
      <HelpTooltip help={{ body: t(role.helpKey, role.helpParams) }}>
        <Box component="span" sx={{ position: 'absolute', bottom: 4, left: 4, cursor: 'help', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.65)', px: '6px', py: '1px', fontFamily: 'var(--font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)' }}>
          {t(role.noteKey, role.noteParams)}
        </Box>
      </HelpTooltip>
      {index > 0 && (
        <TipIconButton labelId="imageStudio.ref.moveFirst" size="small" tone="default" onClick={onMoveFirst} sx={{ ...corner, left: -6, top: -6 }}>
          <FirstPageRounded sx={{ fontSize: 12 }} />
        </TipIconButton>
      )}
      <TipIconButton labelId="imageStudio.ref.remove" size="small" tone="default" onClick={onRemove} sx={{ ...corner, right: -6, top: -6 }}>
        <CloseRounded sx={{ fontSize: 12 }} />
      </TipIconButton>
      {asset.width && asset.height ? (
        <Box sx={{ mt: '3px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: index === 0 ? 'var(--ink-2)' : 'var(--faint)' }}>
          {asset.width}×{asset.height}
        </Box>
      ) : null}
    </Box>
  )
}

function PendingThumb({ upload }: { upload: PendingUpload }) {
  return (
    <Box sx={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0, overflow: 'hidden', borderRadius: '12px', boxShadow: '0 0 0 1px var(--line)' }}>
      <Box component="img" src={upload.previewUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink)' }}>
        <CircularProgress size={18} color="inherit" />
      </Box>
    </Box>
  )
}

interface ReferenceStripProps {
  model: ModelInfo
  references: readonly Asset[]
  uploading: readonly PendingUpload[]
  onRemove: (id: string) => void
  onMove: (id: string, index: number) => void
}

/**
 * The attached images: each with its role for the model (start image, "image N", ignored) and its size, removable and
 * reorderable (drag onto another image, or "move first"): the first one gives the format and size of "Reference".
 * Imports in progress come after them.
 */
export function ReferenceStrip({ model, references, uploading, onRemove, onMove }: ReferenceStripProps) {
  const [over, setOver] = useState<number | null>(null)
  if (references.length === 0 && uploading.length === 0) return null
  const isReorder = (event: DragEvent) => event.dataTransfer.types.includes(REORDER_TYPE)
  return (
    <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', px: 1.75, pt: 1.75, pb: '6px' }}>
      {references.map((asset, index) => (
        <RefThumb
          key={asset.id}
          asset={asset}
          model={model}
          index={index}
          dropTarget={over === index}
          onRemove={() => onRemove(asset.id)}
          onMoveFirst={() => onMove(asset.id, 0)}
          onDragStart={(event) => {
            event.dataTransfer.setData(REORDER_TYPE, asset.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (!isReorder(event)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setOver(index)
          }}
          onDrop={(event) => {
            if (!isReorder(event)) return
            event.preventDefault()
            setOver(null)
            onMove(event.dataTransfer.getData(REORDER_TYPE), index)
          }}
          onDragEnd={() => setOver(null)}
        />
      ))}
      {uploading.map((upload) => (
        <PendingThumb key={upload.tempId} upload={upload} />
      ))}
    </Box>
  )
}
