/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import { formatClock, formatDuration } from '@/modules_shared/common/components/ui/progress'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import type { ModelInfo } from '@/modules/model-catalog'
import { useNow } from '../hooks/useNow'
import { formatTime } from '../lib/format'
import { queueIndex, statusLine } from '../lib/messageState'
import { useLiveStore } from '../state/liveStore'
import { useQueueStore } from '../state/queueStore'
import type { Message } from '../types'

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11 }

/** The line next to the model name: waiting, loading the model (with a clock), step and remaining time, or the summary. */
export function StatusLine({ message, model }: { message: Message; model: ModelInfo | undefined }) {
  const t = useT()
  const lang = useLang()
  const progress = useLiveStore((s) => s.progress[message.id])
  const waiting = useQueueStore((s) => s.queue)
  const now = useNow(message.status === 'loading' || message.status === 'running')
  const line = statusLine(message, progress, {
    now,
    queueIndex: message.status === 'queued' ? queueIndex(waiting, message.id) : -1,
    modelInstalled: model ? model.install === 'installed' : true,
  })
  if (line.kind === 'queued') {
    return (
      <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>
        {t('thread.status.queued')}
        {line.position ? ` · ${t('thread.status.position', [line.position])}` : ''}
      </Box>
    )
  }
  if (line.kind === 'loading') {
    return (
      <Box component="span" sx={{ ...mono, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)' }}>
        <CircularProgress size={12} color="inherit" />
        {t('thread.status.loading', [formatClock(line.elapsed)])}
        {line.downloadable && ` · ${t('thread.status.downloadPossible')}`}
      </Box>
    )
  }
  if (line.kind === 'running') {
    return (
      <Box component="span" sx={{ ...mono, color: 'var(--safe)' }}>
        {line.step ? t('thread.status.step', [line.step, line.total ?? 0]) : t('thread.status.preparing')}
        {line.image ? ` · ${t('thread.status.image', [line.image, message.params.count ?? 1])}` : ''}
        {line.eta != null ? ` · ${t('thread.status.remaining', [formatDuration(line.eta, lang)])}` : ''}
      </Box>
    )
  }
  const parts = [
    line.size,
    line.steps ? t('thread.status.steps', [line.steps]) : null,
    line.references ? t('thread.status.refs', [line.references]) : null,
    line.duration ? formatDuration(line.duration, lang) : null,
    formatTime(line.createdAt, lang),
  ]
  return (
    <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>
      {parts.filter(Boolean).join(' · ')}
    </Box>
  )
}

