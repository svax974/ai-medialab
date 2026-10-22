/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { ChatMessage } from '../types'
import { Markdown } from './Markdown'
import { Generations } from './GenerationCard'
import { ReasoningBlock, StatsLine, ToolRuns } from './MessageParts'

/**
 * What an answer shows: its thinking, the tools it used, the text as Markdown (a pulsing dot while nothing has come yet),
 * a note when it was stopped or failed, and its statistics once finished.
 */
export function AssistantBody({ message }: { message: ChatMessage }) {
  const t = useT()
  const streaming = message.status === 'streaming'
  const thinking = streaming && !!message.reasoning && message.content === ''
  return (
    <Box>
      {message.reasoning && <ReasoningBlock text={message.reasoning} thinking={thinking} />}
      <ToolRuns runs={message.tool_runs} />
      <Generations message={message} />
      {message.content !== '' ? <Markdown text={message.content} streaming={streaming} /> : streaming && !message.reasoning && message.tool_runs.length === 0 && !message.generations?.length ? <Box aria-label={t('chat.waiting')} role="status" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--safe)', animation: 'var(--animate-breathe)' }} /> : null}
      {message.status === 'cancelled' && <Box sx={{ mt: 1, fontSize: 12, color: 'var(--faint)' }}>{t('chat.stopped')}</Box>}
      {message.status === 'error' && <Box role="alert" sx={{ mt: 1, fontSize: 12.5, color: 'var(--danger)' }}>{message.error ?? t('chat.error.upstream')}</Box>}
      {!streaming && <Box sx={{ mt: 1 }}><StatsLine message={message} /></Box>}
    </Box>
  )
}
