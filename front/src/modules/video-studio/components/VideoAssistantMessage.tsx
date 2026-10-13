/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import MovieCreationOutlined from '@mui/icons-material/MovieCreationOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { useModels } from '@/modules/model-catalog'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { isActive } from '@/modules/studio-core/lib/messageState'
import { useLiveStore } from '@/modules/studio-core/state/liveStore'
import type { Message } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { clipFraction, clipLayout, clipRatio, clipSlots, isFreshClip, pendingLabel } from '../lib/clips'
import { ClipTile, PendingClip } from './ClipTile'
import { VideoMessageFooter } from './VideoMessageFooter'
import { VideoStatusLine } from './VideoStatusLine'

/**
 * A video generation: model and state, the grid of clips (produced with their player, the one being computed, the ones
 * waiting; one clip is drawn wide, two side by side), the error or cancellation, the actions.
 */
export function VideoAssistantMessage({ message, siblings = [] }: { message: Message; siblings?: readonly Message[] }) {
  const t = useT()
  const { data: catalog } = useModels()
  const progress = useLiveStore((s) => s.progress[message.id])
  const show = useLightboxStore((s) => s.show)
  const model = catalog?.models.find((candidate) => candidate.id === message.model_id)
  const active = isActive(message.status)
  const ratio = clipRatio(message.params)
  const slots = clipSlots(message, progress?.index)
  const { cols, maxWidth } = clipLayout(slots.length, ratio)
  return (
    <Box className="msg" sx={{ display: 'flex', gap: '12px', animation: 'var(--animate-rise)' }}>
      <Box sx={{ mt: '2px', display: 'grid', width: 28, height: 28, flexShrink: 0, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--surface-2)', boxShadow: '0 0 0 1px var(--line)' }}>
        <MovieCreationOutlined sx={{ fontSize: 16, color: 'var(--safe)', ...(active ? { animation: 'var(--animate-breathe)' } : {}) }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
          <Box component="span" sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{model?.name ?? message.model_id}</Box>
          <VideoStatusLine message={message} model={model} />
        </Box>
        {slots.length > 0 && (
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: cols === 2 ? '1fr 1fr' : '1fr', maxWidth }}>
            {slots.map((slot, index) => {
              if (slot.kind === 'clip') return <ClipTile key={slot.asset.id} asset={slot.asset} ratio={ratio} fresh={isFreshClip(slot.asset, Date.now() / 1000)} onOpen={() => show(message.outputs, index)} />
              const label = pendingLabel(message.status, slot.running, progress)
              return <PendingClip key={`slot-${index}`} ratio={ratio} active={slot.running} fraction={clipFraction(progress, slot.running)} label={t(label.key, label.params)} />
            })}
          </Box>
        )}
        {message.status === 'error' && (
          <Box role="alert" sx={{ mt: '4px', display: 'flex', maxWidth: 576, alignItems: 'flex-start', gap: '10px', borderRadius: '12px', border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--danger) 10%, transparent)', px: 1.75, py: 1.25, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            <ReportProblemOutlined sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--danger)' }} />
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{message.error ?? t('thread.error.unknown')}</Box>
          </Box>
        )}
        {message.status === 'cancelled' && message.outputs.length === 0 && <Box sx={{ mt: '4px', fontSize: 13, fontStyle: 'italic', color: 'var(--faint)' }}>{t('videoStudio.cancelled')}</Box>}
        <VideoMessageFooter message={message} siblings={siblings} />
      </Box>
    </Box>
  )
}
