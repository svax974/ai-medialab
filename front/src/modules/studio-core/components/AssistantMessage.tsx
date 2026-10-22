/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { useModels } from '@/modules/model-catalog'
import { Mark } from '@/modules/studio-shell/components/Mark'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { MessageKind } from '../hooks/useMessageActions'
import { buildSlots, developingFilter, isActive, isFresh, messageRatio, progressFraction, tileLayout } from '../lib/messageState'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { useLiveStore } from '../state/liveStore'
import type { Message } from '../types'
import { DevelopingTile, ImageTile } from './ImageTile'
import { MessageFooter } from './MessageFooter'
import { StatusLine } from './StatusLine'

/** The model used tells the real kind (`video`/`audio`/`diagram` share this generic component with `image`, which
 * stays the fallback: a deleted/unknown model, or a demo message with none, is drawn as an image generation). */
const messageKind = (modelKind: string | undefined): MessageKind =>
  modelKind === 'diagram' || modelKind === 'audio' || modelKind === 'video' ? modelKind : 'image'

/** A generation: model and state, the grid of images (produced, developing, waiting), the error or cancellation, the actions. */
export function AssistantMessage({ message }: { message: Message; siblings?: readonly Message[] }) {
  const t = useT()
  const { data: catalog } = useModels()
  const progress = useLiveStore((s) => s.progress[message.id])
  const show = useLightboxStore((s) => s.show)
  const model = catalog?.models.find((m) => m.id === message.model_id)
  const active = isActive(message.status)
  const ratio = messageRatio(message.params)
  const slots = buildSlots(message, progress?.index)
  const { cols, maxWidth } = tileLayout(slots.length, ratio)
  const fraction = progressFraction(progress)

  return (
    <Box className="msg" sx={{ display: 'flex', gap: '12px', animation: 'var(--animate-rise)' }}>
      <Box sx={{ mt: '2px', display: 'grid', width: 28, height: 28, flexShrink: 0, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--surface-2)', boxShadow: '0 0 0 1px var(--line)', ...(active ? { animation: 'var(--animate-breathe)' } : {}) }}>
        <Mark size={16} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
          <Box component="span" sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{model?.name ?? message.model_id}</Box>
          <StatusLine message={message} model={model} />
        </Box>
        {slots.length > 0 && (
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: cols === 2 ? '1fr 1fr' : '1fr', maxWidth }}>
            {slots.map((slot, i) =>
              slot.kind === 'image' ? (
                <ImageTile key={slot.asset.id} asset={slot.asset} ratio={ratio} fresh={isFresh(slot.asset, Date.now() / 1000)} onOpen={() => show(message.outputs, i)} />
              ) : (
                <DevelopingTile key={`slot-${i}`} ratio={ratio} previewUrl={slot.kind === 'developing' ? (progress?.preview_url ?? null) : null} filter={developingFilter(slot.kind === 'developing' ? fraction : 0)} fraction={slot.kind === 'developing' ? fraction : 0} active={slot.kind === 'developing'} />
              ),
            )}
          </Box>
        )}
        {message.status === 'error' && (
          <Box role="alert" sx={{ mt: '4px', display: 'flex', maxWidth: 576, alignItems: 'flex-start', gap: '10px', borderRadius: '12px', border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--danger) 10%, transparent)', px: 1.75, py: 1.25, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            <ReportProblemOutlined sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--danger)' }} />
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{message.error ?? t('thread.error.unknown')}</Box>
          </Box>
        )}
        {message.status === 'cancelled' && message.outputs.length === 0 && (
          <Box sx={{ mt: '4px', fontSize: 13, fontStyle: 'italic', color: 'var(--faint)' }}>{t('thread.cancelled')}</Box>
        )}
        <MessageFooter message={message} kind={messageKind(model?.kind)} />
      </Box>
    </Box>
  )
}
