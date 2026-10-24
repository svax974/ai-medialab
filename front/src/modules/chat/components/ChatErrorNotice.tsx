/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { chatErrorInfo, type ChatErrorAction } from '../lib/errors'
import { useChatLiveStore, type StreamFailure } from '../state/chatLiveStore'

interface Props {
  conversationId: string
  failure: StreamFailure
  /** Doubles the context of the conversation (the action of `context_exceeded`). */
  onRaiseContext: () => void
  /** "Continue anyway" (the action of `memory`): confirms, then writes the failed answer again without the memory check. */
  onContinueAnyway: (messageId: string) => void
}

/** An answer that could not be written: what it means in plain words, the server's own message, and the action that helps. */
export function ChatErrorNotice({ conversationId, failure, onRaiseContext, onContinueAnyway }: Props) {
  const t = useT()
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  const info = chatErrorInfo(failure.code)
  const dismiss = () => useChatLiveStore.getState().dismiss(conversationId)
  const act = (action: ChatErrorAction) => {
    if (action === 'install-engine' || action === 'choose-model') setModelsOpen(true)
    else if (action === 'raise-context') onRaiseContext()
    else if (action === 'continue-anyway' && failure.id) onContinueAnyway(failure.id)
    dismiss()
    if (action === 'retry') focusTarget('composer')
  }
  return (
    <Box role="alert" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 12px', borderRadius: '14px', border: '1px solid color-mix(in oklab, var(--warn) 35%, transparent)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)', px: 2, py: 1.25, fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)' }}>
      <ReportProblemOutlined sx={{ mt: '1px', fontSize: 16, color: 'var(--warn)' }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>{t(info.key)}</Box>
        {failure.message && <Box sx={{ mt: '2px', fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{failure.message}</Box>}
      </Box>
      {info.action && <Button size="small" variant="outlined" onClick={() => act(info.action as ChatErrorAction)}>{t(`chat.error.action.${info.action}`)}</Button>}
      <Button size="small" color="inherit" onClick={dismiss}>{t('chat.error.dismiss')}</Button>
    </Box>
  )
}
