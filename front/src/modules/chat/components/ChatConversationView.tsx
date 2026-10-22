/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Box, CircularProgress } from '@mui/material'
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { TitleEditor } from '@/modules/studio-core/components/TitleEditor'
import { isNearBottom, scrollAction } from '@/modules/studio-core/lib/scroll'
import { useConversation } from '@/modules/studio-shell/hooks/useConversations'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { StudioApiError } from '@/modules/studio-shell/services/studioHttp'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { useChatConversation } from '../hooks/useChat'
import { useGenerationSync } from '../hooks/useGenerationSync'
import { answerPaths } from '../services/chatApi'
import { startAnswer } from '../services/answerRunner'
import { useChatDraftStore } from '../state/chatDraftStore'
import { ChatComposer } from './ChatComposer'
import { ChatThread } from './ChatThread'
import { ExportMenu } from './ExportMenu'
import { LlmStatusChip } from './LlmStatusChip'

const WIDTH = 880

/**
 * A chat conversation: editable title, the model in memory, export, the thread (the active branch, following the answer as
 * it is written unless the reader scrolled up), a button back to the bottom, and the composer floating at the bottom. A
 * send handed over by the home page starts here, once the conversation is loaded. A missing conversation goes back home.
 */
export function ChatConversationView({ id }: { id: string }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: summary } = useConversation(id)
  const { data, isLoading, error } = useChatConversation(id)
  useGenerationSync(id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)

  useLayoutEffect(() => {
    lastCount.current = 0
  }, [id])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !data) return
    const action = scrollAction(lastCount.current, data.messages.length)
    if (action === 'jump') el.scrollTop = el.scrollHeight
    else if (action === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    lastCount.current = data.messages.length
  }, [data])
  // The text grows token by token: follow it while the reader is at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (atBottom) el.scrollTop = el.scrollHeight
    })
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [atBottom, id])

  useEffect(() => {
    if (error instanceof StudioApiError && error.status === 404) {
      toast.error(t('thread.notFound'))
      navigate(studioPaths.chatHome, { replace: true })
    }
  }, [error, navigate, t])

  const loaded = !!data
  useEffect(() => {
    if (!loaded) return
    const drafts = useChatDraftStore.getState()
    const pending = drafts.pending
    if (!pending || pending.conversationId !== id) return
    drafts.setPending(null)
    startAnswer(queryClient, id, { path: answerPaths.send(id), body: pending.body, draftKey: pending.draftKey, modelId: pending.modelId, requestedContext: pending.requestedContext })
  }, [loaded, id, queryClient])

  if (isLoading || !data) {
    return (
      <Box sx={{ display: 'grid', flex: 1, placeItems: 'center', color: 'var(--muted)' }}>
        <CircularProgress size={20} color="inherit" />
      </Box>
    )
  }
  const conversation = summary ?? data.conversation
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
      <Box component="header" sx={{ display: 'flex', height: 56, flexShrink: 0, alignItems: 'center', gap: 1.5, borderBottom: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', px: 2.5, pl: sidebarOpen ? 2.5 : 7 }}>
        <TitleEditor id={conversation.id} title={conversation.title} />
        {conversation.pinned && <PushPinOutlined sx={{ fontSize: 14, color: 'var(--faint)' }} />}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LlmStatusChip />
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{t('chat.thread.count', [data.messages.length])}</Box>
          <ExportMenu conversationId={id} />
        </Box>
      </Box>
      <Box ref={scrollRef} onScroll={(event) => setAtBottom(isNearBottom(event.currentTarget))} sx={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
        <Box sx={{ mx: 'auto', display: 'grid', width: '100%', maxWidth: WIDTH, px: 2.5, pb: 28, pt: 4 }}>
          <ChatThread conversationId={id} data={data} />
        </Box>
      </Box>
      <Box sx={{ pointerEvents: 'none', position: 'absolute', inset: 'auto 0 0 0', background: 'linear-gradient(to top, var(--bg), color-mix(in oklab, var(--bg) 90%, transparent), transparent)', pb: 2, pt: 5 }}>
        <Box sx={{ pointerEvents: 'auto', position: 'relative', mx: 'auto', width: '100%', maxWidth: WIDTH, px: 2.5 }}>
          {!atBottom && (
            <TipIconButton labelId="thread.scrollBottom" tone="default" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })} sx={{ position: 'absolute', top: -48, left: '50%', zIndex: 10, transform: 'translateX(-50%)', width: 36, height: 36, border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-2)', color: 'var(--ink-2)', animation: 'var(--animate-fade)' }}>
              <KeyboardArrowDownRounded sx={{ fontSize: 18 }} />
            </TipIconButton>
          )}
          <ChatComposer conversationId={id} />
        </Box>
      </Box>
    </Box>
  )
}
