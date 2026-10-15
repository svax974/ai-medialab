/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { AdviceJob } from '../lib/adviceQueue'
import type { UpdateAdvisory } from '../types'
import { AdviceBlock } from './AdviceBlock'

export interface AdviceSlotProps {
  advice: UpdateAdvisory | null
  /** The analysis of this very update asked for in this session, if any. */
  job: AdviceJob | undefined
  /** An analysis can be started (a local model is ready). */
  canAnalyse: boolean
  onAnalyse: () => void
  onForget?: () => void
}

/** What a row says about the risks of its update: the advice, or the analysis under way or failed, or the button that starts one. */
export function AdviceSlot({ advice, job, canAnalyse, onAnalyse, onForget }: AdviceSlotProps) {
  const t = useT()
  const active = job?.status === 'queued' || job?.status === 'running'
  const status = active && (
    <Box role="status" sx={{ mt: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: 11.5, color: 'var(--muted)' }}>
      <CircularProgress size={12} aria-hidden />
      {t(job?.status === 'running' ? 'updates.advice.running' : 'updates.advice.queued')}
    </Box>
  )
  const failed = job?.status === 'error' && (
    <Box role="alert" sx={{ mt: '6px', fontSize: 11.5, color: 'var(--danger)' }}>
      {t('updates.advice.failed', [job.error ?? ''])}
      {canAnalyse && <Button size="small" variant="text" onClick={onAnalyse} sx={{ ml: 1, fontSize: 11 }}>{t('updates.retry')}</Button>}
    </Box>
  )
  return (
    <>
      {status}
      {failed}
      {advice && <AdviceBlock advice={advice} onRerun={canAnalyse && !active ? onAnalyse : undefined} onForget={onForget} />}
      {!advice && !active && job?.status !== 'error' && canAnalyse && (
        <Button size="small" variant="text" onClick={onAnalyse} sx={{ mt: '2px', px: 0.5, alignSelf: 'start', fontSize: 11.5 }}>{t('updates.advice.analyse')}</Button>
      )}
    </>
  )
}
