/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box } from '@mui/material'
import EjectRounded from '@mui/icons-material/EjectRounded'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { chatApi } from '../services/chatApi'
import { anyStreaming, useChatLiveStore } from '../state/chatLiveStore'
import type { LlmStatus } from '../types'
import { useModelName } from '../hooks/useModelName'

const DOT = { idle: 'var(--faint)', loading: 'var(--warn)', ready: 'var(--ok)', generating: 'var(--safe)' } as const

/** The chat model in memory (state from the engine's `llm.status` event): its name and context, or that none is loaded; the eject button unloads it. */
export function LlmStatusView({ status, onUnload }: { status: LlmStatus | null; onUnload?: () => void }) {
  const t = useT()
  const name = useModelName(status?.model_id ?? null)
  if (!status) return null
  const loaded = status.state !== 'idle'
  const text = loaded ? t(`chat.llm.${status.state}`, [name, status.context_size ? Math.round(status.context_size / 1024) : 0]) : t('chat.llm.idle')
  return (
    <Box role="status" title={t('chat.llm.tip')} sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>
      <Box aria-hidden component="span" sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: DOT[status.state] }} />
      {text}
      {onUnload && status.state === 'ready' && (
        <TipIconButton labelId="chat.llm.unload" size="small" onClick={onUnload} sx={{ width: 24, height: 24 }}>
          <EjectRounded sx={{ fontSize: 14 }} />
        </TipIconButton>
      )}
    </Box>
  )
}

/** The state of the chat model, read from the live store (fed by the engine's events), with the button that unloads it (never while an answer is written). */
export function LlmStatusChip() {
  const t = useT()
  const status = useChatLiveStore((s) => s.status)
  const answering = useChatLiveStore(anyStreaming)
  const [working, setWorking] = useState(false)
  const unload = () => {
    setWorking(true)
    chatApi.unloadModel().then(() => toast.success(t('chat.llm.unloaded')), (error: Error) => toast.error(error.message)).finally(() => setWorking(false))
  }
  return <LlmStatusView status={status} onUnload={answering || working ? undefined : unload} />
}
