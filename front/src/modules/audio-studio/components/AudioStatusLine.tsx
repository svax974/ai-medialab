/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import { formatClock, formatDuration } from '@/modules_shared/common/components/ui/progress'
import type { ModelInfo } from '@/modules/model-catalog'
import { useNow } from '@/modules/studio-core/hooks/useNow'
import { formatTime } from '@/modules/studio-core/lib/format'
import { queueIndex } from '@/modules/studio-core/lib/messageState'
import { useLiveStore } from '@/modules/studio-core/state/liveStore'
import { useQueueStore } from '@/modules/studio-core/state/queueStore'
import type { Message } from '@/modules/studio-core'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { audioStatus } from '../lib/audioStatus'

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11 }

/** The line next to the model name: waiting (with the position), loading the model, pass and take and remaining time, or language · time to generate · time of day. */
export function AudioStatusLine({ message, model }: { message: Message; model: ModelInfo | undefined }) {
  const t = useT()
  const lang = useLang()
  const progress = useLiveStore((s) => s.progress[message.id])
  const waiting = useQueueStore((s) => s.queue)
  const now = useNow(message.status === 'loading' || message.status === 'running')
  const status = audioStatus(message, progress, { now, queueIndex: message.status === 'queued' ? queueIndex(waiting, message.id) : -1, caps: model?.audio })
  if (status.kind === 'queued') {
    return <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>{t('thread.status.queued')}{status.position ? ` · ${t('thread.status.position', [status.position])}` : ''}</Box>
  }
  if (status.kind === 'loading') {
    return <Box component="span" sx={{ ...mono, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)' }}><CircularProgress size={12} color="inherit" />{t('thread.status.loading', [formatClock(status.elapsed)])}</Box>
  }
  if (status.kind === 'running') {
    return (
      <Box component="span" sx={{ ...mono, color: 'var(--safe)' }}>
        {status.pass ? t('audioStudio.status.pass', [status.pass, status.total ?? 0]) : t('audioStudio.status.synthesizing')}
        {status.take ? ` · ${t('audioStudio.status.take', [status.take, message.params.count ?? 1])}` : ''}
        {status.eta != null ? ` · ${t('thread.status.remaining', [formatDuration(status.eta, lang)])}` : ''}
      </Box>
    )
  }
  const parts = [status.language, status.duration ? t('audioStudio.status.generatedIn', [formatDuration(status.duration, lang)]) : null, formatTime(status.createdAt, lang)]
  return <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>{parts.filter(Boolean).join(' · ')}</Box>
}
