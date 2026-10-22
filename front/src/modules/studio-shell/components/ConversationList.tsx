/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { formatMonth, groupConversations, periodLabelKey } from '../lib/periods'
import { homePathForMode, matchStudioRoute } from '../lib/routes'
import { useConversationActions, useConversationList } from '../hooks/useConversations'
import { useLang, useT } from '../hooks/useT'
import type { StudioMode } from '../types'
import { ChatSearchHits } from '@/modules/chat/components/ChatSearchHits'
import { ConversationItem } from './ConversationItem'
import { SelectionBar } from './SelectionBar'

const DELETE_MEDIA_KEYS: Record<StudioMode, string> = {
  image: 'studio.conversation.delete.media.image',
  audio: 'studio.conversation.delete.media.audio',
  video: 'studio.conversation.delete.media.video',
  chat: 'studio.conversation.delete.media.chat',
  diagram: 'studio.conversation.delete.media.diagram',
}

const EMPTY_KEYS: Record<StudioMode, string> = {
  image: 'studio.list.empty.image',
  audio: 'studio.list.empty.audio',
  video: 'studio.list.empty.video',
  chat: 'studio.list.empty.chat',
  diagram: 'studio.list.empty.diagram',
}

function Note({ children }: { children: React.ReactNode }) {
  return <Box sx={{ px: 1.5, py: 3, fontSize: 14, lineHeight: 1.6, color: 'var(--faint)' }}>{children}</Box>
}

/**
 * Conversations of the current mode, filtered by the search, grouped by period (pinned first). The bar above the list
 * switches to selection mode: ticked conversations are deleted together; only the ones still listed count (a search
 * or a mode change never deletes something that is out of sight).
 */
export function ConversationList({ mode, query }: { mode: StudioMode; query: string }) {
  const t = useT()
  const lang = useLang()
  const { pathname } = useLocation()
  const { data, isLoading, isError, refetch } = useConversationList(mode, query)
  const groups = useMemo(() => groupConversations(data ?? []), [data])
  const match = matchStudioRoute(pathname)
  const activeId = match?.route.name === 'conversation' ? match.id : null
  const navigate = useNavigate()
  const { removeMany } = useConversationActions()
  const [selecting, setSelecting] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const visible = useMemo(() => (data ?? []).filter((c) => ticked.has(c.id)), [data, ticked])
  const stopSelecting = useCallback(() => {
    setSelecting(false)
    setTicked(new Set())
  }, [])
  const toggle = useCallback((id: string) => setTicked((prev) => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])
  useEffect(stopSelecting, [mode, stopSelecting])

  const deleteSelected = async () => {
    const ok = await confirm({
      titleId: 'studio.conversation.deleteMany.title',
      messageId: 'studio.conversation.deleteMany.message',
      params: [visible.length, visible.reduce((sum, c) => sum + c.generation_count, 0), t(DELETE_MEDIA_KEYS[mode])],
      confirmLabelId: 'studio.conversation.delete.confirm',
      danger: true,
    })
    if (!ok) return
    const ids = visible.map((c) => c.id)
    removeMany.mutate(ids, {
      onSuccess: ({ done }) => {
        if (activeId && done.includes(activeId)) navigate(homePathForMode(mode), { replace: true })
        stopSelecting()
      },
    })
  }

  return (
    <Box component="nav" sx={{ mt: 1, flex: 1, overflowY: 'auto', px: 1, pb: 2 }}>
      {(data?.length ?? 0) > 0 && (
        <SelectionBar
          selecting={selecting}
          count={visible.length}
          total={data?.length ?? 0}
          busy={removeMany.isPending}
          onStart={() => setSelecting(true)}
          onStop={stopSelecting}
          onToggleAll={() => setTicked(visible.length === (data?.length ?? 0) ? new Set() : new Set((data ?? []).map((c) => c.id)))}
          onDelete={() => void deleteSelected()}
        />
      )}
      {isLoading && <Note>{t('studio.list.loading')}</Note>}
      {isError && (
        <Note>
          {t('studio.list.error')}
          <Box sx={{ mt: 1 }}>
            <Button size="small" onClick={() => void refetch()}>
              {t('studio.list.retry')}
            </Button>
          </Box>
        </Note>
      )}
      {!isLoading && !isError && groups.length === 0 && (
        <Box sx={{ px: 1.5, py: 4, textAlign: 'center', fontSize: 14, lineHeight: 1.6, color: 'var(--faint)' }}>
          {query ? t('studio.list.noResult') : t(EMPTY_KEYS[mode])}
        </Box>
      )}
      {groups.map((group) => {
        const labelKey = periodLabelKey(group.period)
        const label = labelKey ? t(labelKey) : group.period.kind === 'month' ? formatMonth(group.period, lang) : ''
        return (
          <Box key={group.id} sx={{ mt: 2, '&:first-of-type': { mt: 1 } }}>
            <Box className="cn-eyebrow" sx={{ px: 1.5, pb: '6px' }}>
              {label}
            </Box>
            {group.items.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                selecting={selecting}
                selected={ticked.has(conversation.id)}
                onToggle={toggle}
              />
            ))}
          </Box>
        )
      })}
      {mode === 'chat' && <ChatSearchHits query={query} />}
    </Box>
  )
}
