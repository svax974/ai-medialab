/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'react'
import { Box, Button } from '@mui/material'
import { useLocation } from 'react-router-dom'
import { formatMonth, groupConversations, periodLabelKey } from '../lib/periods'
import { matchStudioRoute } from '../lib/routes'
import { useConversationList } from '../hooks/useConversations'
import { useLang, useT } from '../hooks/useT'
import type { StudioMode } from '../types'
import { ConversationItem } from './ConversationItem'

const EMPTY_KEYS: Record<StudioMode, string> = {
  image: 'studio.list.empty.image',
  audio: 'studio.list.empty.audio',
  video: 'studio.list.empty.video',
}

function Note({ children }: { children: React.ReactNode }) {
  return <Box sx={{ px: 1.5, py: 3, fontSize: 14, lineHeight: 1.6, color: 'var(--faint)' }}>{children}</Box>
}

/** Conversations of the current mode, filtered by the search, grouped by period (pinned first). */
export function ConversationList({ mode, query }: { mode: StudioMode; query: string }) {
  const t = useT()
  const lang = useLang()
  const { pathname } = useLocation()
  const { data, isLoading, isError, refetch } = useConversationList(mode, query)
  const groups = useMemo(() => groupConversations(data ?? []), [data])
  const match = matchStudioRoute(pathname)
  const activeId = match?.route.name === 'conversation' ? match.id : null

  return (
    <Box component="nav" sx={{ mt: 1, flex: 1, overflowY: 'auto', px: 1, pb: 2 }}>
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
              <ConversationItem key={conversation.id} conversation={conversation} active={conversation.id === activeId} />
            ))}
          </Box>
        )
      })}
    </Box>
  )
}
