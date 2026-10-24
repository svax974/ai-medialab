/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useConversation } from '@/modules/studio-shell/hooks/useConversations'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { StudioApiError } from '@/modules/studio-shell/services/studioHttp'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import type { ModeAdapters } from '../lib/modeAdapter'
import { useOverlayHeight } from '../hooks/useOverlayHeight'
import { isNearBottom, scrollAction } from '../lib/scroll'
import { TitleEditor } from './TitleEditor'
import { UserMessage } from './UserMessage'

const WIDTH = 880

/**
 * A conversation: editable title and count, the thread (user messages and generations of its mode), a button back to the
 * bottom when scrolled up, and the composer of the mode floating at the bottom. A missing conversation (404) goes
 * back to the home page with a message. A mode without an adapter shows a notice.
 */
export function ConversationView({ id, adapters }: { id: string; adapters: ModeAdapters }) {
  const t = useT()
  const navigate = useNavigate()
  const { data: conversation, isLoading, error } = useConversation(id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)
  const [composerRef, composerHeight] = useOverlayHeight()

  useLayoutEffect(() => {
    lastCount.current = 0
  }, [id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !conversation) return
    const action = scrollAction(lastCount.current, conversation.messages.length)
    if (action === 'jump') el.scrollTop = el.scrollHeight
    else if (action === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    lastCount.current = conversation.messages.length
  }, [conversation])

  // Images load late: stay pinned to the bottom when the user is there.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (atBottom) el.scrollTop = el.scrollHeight
    })
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [atBottom, conversation?.id])

  useEffect(() => {
    if (error instanceof StudioApiError && error.status === 404) {
      toast.error(t('thread.notFound'))
      navigate(studioPaths.home, { replace: true })
    }
  }, [error, navigate, t])

  if (isLoading || !conversation) {
    return (
      <Box sx={{ display: 'grid', flex: 1, placeItems: 'center', color: 'var(--muted)' }}>
        <CircularProgress size={20} color="inherit" />
      </Box>
    )
  }

  // A chat is drawn by the `chat` module (its messages are not generations): see `ConversationPage`.
  if (conversation.mode === 'chat') return null
  const adapter = adapters[conversation.mode]
  const kind = conversation.mode
  const messages = conversation.messages
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
      <Box component="header" sx={{ display: 'flex', height: 56, flexShrink: 0, alignItems: 'center', gap: 1.5, borderBottom: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', px: 2.5, pl: sidebarOpen ? 2.5 : 7 }}>
        <TitleEditor id={conversation.id} title={conversation.title} />
        {conversation.pinned && <PushPinOutlined sx={{ fontSize: 14, color: 'var(--faint)' }} />}
        <Box component="span" sx={{ ml: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>
          {t(`thread.count.${kind}`, [conversation.generation_count])}
        </Box>
      </Box>

      <Box ref={scrollRef} onScroll={(event) => setAtBottom(isNearBottom(event.currentTarget))} sx={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
        <Box sx={{ mx: 'auto', display: 'grid', width: '100%', maxWidth: WIDTH, gap: 3.5, px: 2.5, pb: `${Math.max(composerHeight + 24, 96)}px`, pt: 4 }}>
          {adapter
            ? messages.map((message) =>
                message.role === 'user' ? (
                  <UserMessage key={message.id} message={message} kind={kind} onReuse={adapter.reuseUserMessage} />
                ) : (
                  <adapter.AssistantMessage key={message.id} message={message} siblings={messages} />
                ),
              )
            : null}
          {!adapter && <Box sx={{ py: 10, textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>{t('thread.unsupported')}</Box>}
          {adapter && messages.length === 0 && <Box sx={{ py: 10, textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>{t(`thread.empty.${kind}`)}</Box>}
        </Box>
      </Box>

      {adapter && (
        <Box ref={composerRef} sx={{ pointerEvents: 'none', position: 'absolute', inset: 'auto 0 0 0', background: 'linear-gradient(to top, var(--bg), color-mix(in oklab, var(--bg) 90%, transparent), transparent)', pb: 2, pt: 5 }}>
          <Box sx={{ pointerEvents: 'auto', position: 'relative', mx: 'auto', width: '100%', maxWidth: WIDTH, px: 2.5 }}>
            {!atBottom && (
              <TipIconButton
                labelId="thread.scrollBottom"
                tone="default"
                onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
                sx={{ position: 'absolute', top: -48, left: '50%', zIndex: 10, transform: 'translateX(-50%)', width: 36, height: 36, border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-2)', color: 'var(--ink-2)', animation: 'var(--animate-fade)' }}
              >
                <KeyboardArrowDownRounded sx={{ fontSize: 18 }} />
              </TipIconButton>
            )}
            <adapter.Composer conversationId={conversation.id} />
          </Box>
        </Box>
      )}
    </Box>
  )
}
