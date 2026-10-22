/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import { formatClock, formatDuration } from '@/modules_shared/common/components/ui/progress'
import type { ModelInfo } from '@/modules/model-catalog'
import { useNow } from '@/modules/studio-core/hooks/useNow'
import { formatSeconds, formatTime } from '@/modules/studio-core/lib/format'
import { queueIndex } from '@/modules/studio-core/lib/messageState'
import { useLiveStore } from '@/modules/studio-core/state/liveStore'
import { useQueueStore } from '@/modules/studio-core/state/queueStore'
import type { Message } from '@/modules/studio-core'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { videoStatus, type VideoStatus } from '../lib/clips'

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11 }

/** The text of a status: waiting (with the position), loading the model (with a clock), step or stage and clip and remaining time, or the summary. */
export function VideoStatusView({ status, clips }: { status: VideoStatus; clips: number }) {
  const t = useT()
  const lang = useLang()
  if (status.kind === 'queued') {
    return <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>{t('thread.status.queued')}{status.position ? ` · ${t('thread.status.position', [status.position])}` : ''}</Box>
  }
  if (status.kind === 'loading') {
    return (
      <Box component="span" sx={{ ...mono, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)' }}>
        <CircularProgress size={12} color="inherit" />
        {t('thread.status.loading', [formatClock(status.elapsed)])}
        {status.downloadable ? ` · ${t('thread.status.downloadPossible')}` : ''}
      </Box>
    )
  }
  if (status.kind === 'running') {
    return (
      <Box component="span" sx={{ ...mono, color: 'var(--safe)' }}>
        {status.step ? t('thread.status.step', [status.step, status.total ?? 0]) : t(status.stageKey)}
        {status.clip ? ` · ${t('videoStudio.status.clip', [status.clip, clips])}` : ''}
        {status.eta != null ? ` · ${t('thread.status.remaining', [formatDuration(status.eta, lang)])}` : ''}
      </Box>
    )
  }
  const parts = [
    status.size,
    status.seconds != null ? formatSeconds(status.seconds, lang) : null,
    status.steps ? t('thread.status.steps', [status.steps]) : null,
    status.duration ? t('videoStudio.status.generatedIn', [formatDuration(status.duration, lang)]) : null,
    formatTime(status.createdAt, lang),
  ]
  return <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>{parts.filter(Boolean).join(' · ')}</Box>
}

/**
 * The line next to the model name, from the live progress and the queue: waiting (with the position), loading the model
 * (with a clock), step or stage (the engine reports decoding and encoding, which show no steps), clip and remaining time, or
 * size · duration · steps · time to generate · time of day.
 */
export function VideoStatusLine({ message, model }: { message: Message; model: ModelInfo | undefined }) {
  const progress = useLiveStore((s) => s.progress[message.id])
  const waiting = useQueueStore((s) => s.queue)
  const now = useNow(message.status === 'loading' || message.status === 'running')
  const status = videoStatus(message, progress, {
    now,
    queueIndex: message.status === 'queued' ? queueIndex(waiting, message.id) : -1,
    modelInstalled: model ? model.install === 'installed' : true,
    caps: model?.video,
  })
  return <VideoStatusView status={status} clips={message.params.count ?? 1} />
}
