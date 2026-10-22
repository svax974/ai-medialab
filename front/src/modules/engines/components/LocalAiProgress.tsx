/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import { ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { Notice } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { LocalAiSetup } from '../hooks/useLocalAiSetup'

/**
 * What a screen shows while the local AI setup runs (`useLocalAiSetup`): the step (engine, then model), its progress bar and
 * the message of the installer, a cancel button, and the error of the last attempt. Renders nothing when there is nothing to show.
 */
export function LocalAiProgress({ setup }: { setup: Pick<LocalAiSetup, 'state' | 'progress' | 'modelName' | 'error' | 'cancel'> }) {
  const t = useT()
  const { state, progress, error } = setup
  if (state === 'error' && error !== null) return <Notice framed tone="danger">{t('engines.localAi.error', [error])}</Notice>
  if (state !== 'installing' && state !== 'downloading') return null
  const label = t(progress?.step === 'engine' || state === 'installing' ? 'engines.localAi.step.engine' : 'engines.localAi.step.model', [setup.modelName ?? ''])
  return (
    <Box role="status" aria-live="polite" sx={{ display: 'grid', gap: '4px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={14} aria-hidden />
        <Box component="span" sx={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>{label}</Box>
        <Button size="small" variant="text" onClick={() => void setup.cancel()}>{t('engines.cancel')}</Button>
      </Box>
      {progress && progress.total > 0 && <ProgressBar done={progress.done} total={progress.total} rate={progress.rate} etaSeconds={progress.eta ?? undefined} />}
      {progress?.message && <Box component="p" sx={{ m: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--faint)' }}>{progress.message}</Box>}
    </Box>
  )
}
