/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import { Link } from 'react-router-dom'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useChatSearch } from '../hooks/useChat'

/** In chat mode, under the conversations whose title matches: the messages of every chat that contain the search (excerpts). */
export function ChatSearchHits({ query }: { query: string }) {
  const t = useT()
  const { data, isLoading } = useChatSearch(query)
  if (query.trim().length < 2 || (!isLoading && (data?.length ?? 0) === 0)) return null
  return (
    <Box component="section" aria-label={t('chat.search.title')} sx={{ mt: 2 }}>
      <Box className="cn-eyebrow" sx={{ px: 1.5, pb: '6px' }}>{t('chat.search.title')}</Box>
      {isLoading && <Box sx={{ px: 1.5, fontSize: 12, color: 'var(--faint)' }}>{t('studio.list.loading')}</Box>}
      {data?.map((hit) => (
        <ButtonBase key={`${hit.conversation_id}:${hit.message_id}`} component={Link} to={studioPaths.conversation(hit.conversation_id)} sx={{ display: 'block', width: '100%', borderRadius: '10px', px: 1.5, py: '6px', textAlign: 'left', fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-2)', '&:hover': { backgroundColor: 'var(--surface-2)' } }}>
          <Box sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{hit.snippet}</Box>
        </ButtonBase>
      ))}
    </Box>
  )
}
