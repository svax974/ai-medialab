/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { useNow } from '@/modules/studio-core/hooks/useNow'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useModelName } from '../hooks/useModelName'
import type { LiveStream } from '../state/chatLiveStore'

/** While the model loads: its name and a clock; after a change of context, that the model reloads with the new size. */
export function ChatStatusLine({ stream }: { stream: LiveStream }) {
  const t = useT()
  const loading = stream.loading
  const now = useNow(!!loading)
  const name = useModelName(loading?.modelId || null)
  if (!loading) return null
  const elapsed = Math.max(0, loading.elapsed ?? now - stream.startedAt)
  const text = loading.reloadContext !== null ? t('chat.status.reloadContext', [loading.reloadContext]) : t('chat.status.loadingModel')
  return (
    <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)' }}>
      <CircularProgress size={12} color="inherit" />
      <span>{name ? `${name} · ` : ''}{text} {formatClock(elapsed)}</span>
    </Box>
  )
}
