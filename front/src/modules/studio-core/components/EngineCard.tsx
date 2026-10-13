/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import PowerSettingsNewRounded from '@mui/icons-material/PowerSettingsNewRounded'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { useEngineStatus, useUnloadEngine } from '@/modules/hardware'
import { useModels } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useNow } from '../hooks/useNow'
import { engineCardView } from '../lib/engineState'

const DOT: Record<string, object> = {
  warn: { backgroundColor: 'var(--warn)', animation: 'var(--animate-breathe)' },
  safe: { backgroundColor: 'var(--safe)', boxShadow: '0 0 8px var(--safe)', animation: 'var(--animate-breathe)' },
  ok: { backgroundColor: 'var(--ok)' },
  idle: { backgroundColor: 'var(--faint)' },
}

/** State of the generation engine in the sidebar: model loading (clock), generating, loaded (unload button), waiting count. */
export function EngineCard() {
  const t = useT()
  const { data: status } = useEngineStatus()
  const { data: catalog } = useModels()
  const unload = useUnloadEngine()
  const now = useNow(status?.state === 'loading')
  if (!status) return null

  const model = catalog?.models.find((m) => m.id === status.model_id)
  const view = engineCardView(status, model?.name ?? null, model?.kind ?? null)
  const detail = view.detail && 'clockFrom' in view.detail ? formatClock(now - view.detail.clockFrom) : view.detail ? t(view.detail.key, view.detail.params) : ''
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.5, py: 1 }}>
      <Box component="span" sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', ...DOT[view.tone] }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--ink)' }}>{view.name ?? t(view.labelKey ?? 'thread.engine.none')}</Box>
        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>
          {detail}
          {view.queued > 0 && ` · ${t('thread.engine.queued', [view.queued])}`}
        </Box>
      </Box>
      {view.canUnload && (
        <TipIconButton labelId="thread.engine.unload" size="small" disabled={unload.isPending} onClick={() => unload.mutate(undefined, { onSuccess: () => void toast.success(t('thread.engine.unloaded')) })} sx={{ width: 28, height: 28 }}>
          <PowerSettingsNewRounded sx={{ fontSize: 14 }} />
        </TipIconButton>
      )}
    </Box>
  )
}
