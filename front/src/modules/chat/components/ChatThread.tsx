/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { toast } from 'react-toastify'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { comparisonSet } from '../lib/branches'
import { requestedContext } from '../lib/context'
import { useChatActions } from '../hooks/useChatActions'
import { useSiblingsSync } from '../hooks/useSiblings'
import { useChatModel, useChatSettings } from '../hooks/useChat'
import { useChatDraftStore } from '../state/chatDraftStore'
import { useChatLiveStore } from '../state/chatLiveStore'
import type { ChatConversation } from '../types'
import { AssistantMessageView } from './AssistantMessageView'
import { ChatErrorNotice } from './ChatErrorNotice'
import { ChatStatusLine } from './ChatStatusLine'
import { ChatSuggestions } from './ChatSuggestions'
import { UserMessageView } from './UserMessageView'

const HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

/**
 * The messages of the active branch, then what surrounds the answer in progress: the loading of the model and the error
 * of a failed answer. Role `log` with a polite live region would read every token: the stream is announced once, by the
 * status line, and the finished answer is reachable by keyboard.
 */
export function ChatThread({ conversationId, data }: { conversationId: string; data: ChatConversation }) {
  const t = useT()
  const { settings, update } = useChatSettings(conversationId)
  const model = useChatModel(settings)
  const actions = useChatActions(conversationId, settings, model)
  const stream = useChatLiveStore((s) => s.streams[conversationId])
  const anyBusy = useChatLiveStore((s) => Object.values(s.streams).some((x) => x.active))
  const seen = useChatDraftStore((s) => s.seen)
  const seenMap = new Map(Object.entries(seen))
  useSiblingsSync(conversationId, data.messages)
  const raiseContext = () => {
    const caps = model?.llm
    const current = settings ? requestedContext(settings, model) : null
    if (!caps || !current) return
    const next = Math.min(current * 2, caps.context_max)
    update({ context_size: next })
    toast.info(t('chat.context.raised', [next]))
  }
  const messages = data.messages
  return (
    <Box role="log" aria-live="off" aria-label={t('chat.thread.aria')} sx={{ display: 'grid', gap: 3.5 }}>
      {/* One short announcement per answer instead of one per token. */}
      <Box role="status" aria-live="polite" sx={HIDDEN}>{stream?.active ? t('chat.announce.writing') : ''}</Box>
      {messages.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Box sx={{ fontSize: 14, color: 'var(--faint)' }}>{t('chat.thread.empty')}</Box>
          <ChatSuggestions draftKey={conversationId} />
        </Box>
      )}
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessageView key={message.id} message={message} busy={anyBusy} onEdit={actions.edit} onDelete={(m) => void actions.remove(m)} onSwitch={actions.switchBranch} />
        ) : (
          <AssistantMessageView key={message.id} message={message} group={comparisonSet(message, seenMap)} busy={anyBusy} onRegenerate={actions.regenerate} onDelete={(m) => void actions.remove(m)} onSwitch={actions.switchBranch} onStop={actions.stop} />
        ),
      )}
      {stream?.loading && <ChatStatusLine stream={stream} />}
      {stream?.error && <ChatErrorNotice conversationId={conversationId} failure={stream.error} onRaiseContext={raiseContext} onContinueAnyway={(id) => { const failed = messages.find((m) => m.id === id); if (failed) void actions.continueAnyway(failed) }} />}
    </Box>
  )
}
