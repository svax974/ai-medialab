/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { useModels } from '@/modules/model-catalog'
import { isActive } from '@/modules/studio-core/lib/messageState'
import { useLiveStore } from '@/modules/studio-core/state/liveStore'
import type { Message } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useAutoplayFirstTake } from '../hooks/useAutoplayFirstTake'
import { takeFraction, takeSlots } from '../lib/takes'
import { AudioMessageFooter } from './AudioMessageFooter'
import { AudioStatusLine } from './AudioStatusLine'
import { PendingTake } from './PendingTake'
import { TakeCard } from './TakeCard'

/**
 * A synthesis: model and state, a card per take (player and waveform) or a placeholder for each take still to come, the
 * error or cancellation, the actions. The first take starts by itself when it has just been produced and autoplay is on.
 */
export function AudioAssistantMessage({ message }: { message: Message; siblings?: readonly Message[] }) {
  const t = useT()
  const { data: catalog } = useModels()
  const progress = useLiveStore((s) => s.progress[message.id])
  const model = catalog?.models.find((candidate) => candidate.id === message.model_id)
  const active = isActive(message.status)
  const count = message.params.count ?? 1
  const slots = takeSlots(message, progress?.index)
  useAutoplayFirstTake(message.outputs[0])
  return (
    <Box className="msg" sx={{ display: 'flex', gap: '12px', animation: 'var(--animate-rise)' }}>
      <Box sx={{ mt: '2px', display: 'grid', width: 28, height: 28, flexShrink: 0, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--surface-2)', boxShadow: '0 0 0 1px var(--line)' }}>
        <GraphicEqRounded sx={{ fontSize: 16, color: 'var(--safe)', ...(active ? { animation: 'var(--animate-breathe)' } : {}) }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
          <Box component="span" sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{model?.name ?? message.model_id}</Box>
          <AudioStatusLine message={message} model={model} />
        </Box>
        {slots.length > 0 && (
          <Box sx={{ display: 'grid', maxWidth: 680, gap: 1 }}>
            {slots.map((slot, index) =>
              slot.kind === 'take' ? <TakeCard key={slot.asset.id} asset={slot.asset} index={index} total={count} /> : <PendingTake key={`pending-${index}`} running={slot.running} fraction={takeFraction(progress, slot.running)} />,
            )}
          </Box>
        )}
        {message.status === 'error' && (
          <Box role="alert" sx={{ mt: '4px', display: 'flex', maxWidth: 576, alignItems: 'flex-start', gap: '10px', borderRadius: '12px', border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--danger) 10%, transparent)', px: 1.75, py: 1.25, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            <ReportProblemOutlined sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--danger)' }} />
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{message.error ?? t('thread.error.unknown')}</Box>
          </Box>
        )}
        {message.status === 'cancelled' && message.outputs.length === 0 && <Box sx={{ mt: '4px', fontSize: 13, fontStyle: 'italic', color: 'var(--faint)' }}>{t('audioStudio.cancelled')}</Box>}
        <AudioMessageFooter message={message} />
      </Box>
    </Box>
  )
}
