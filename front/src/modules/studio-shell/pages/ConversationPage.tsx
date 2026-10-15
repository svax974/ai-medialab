/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { audioStudioAdapter } from '@/modules/audio-studio'
import { imageStudioAdapter } from '@/modules/image-studio'
import { videoStudioAdapter } from '@/modules/video-studio'
import { ConversationView, type ModeAdapters } from '@/modules/studio-core'
import { useConversation } from '../hooks/useConversations'

/** Adapters of the creation modes: image (H4.3), audio (H4.5), video (H4.6). The chat draws its own thread (`modules/chat`). */
const ADAPTERS: ModeAdapters = { image: imageStudioAdapter, audio: audioStudioAdapter, video: videoStudioAdapter }

/** The chat thread is code-split: it brings the Markdown renderer. */
const ChatConversationView = lazy(() => import('@/modules/chat/components/ChatConversationView').then((m) => ({ default: m.ChatConversationView })))

/** `/c/:id`: the thread of the conversation's mode: the chat's own, or the generation thread of `studio-core` with its mode's composer. */
export function ConversationPage() {
  const { id } = useParams()
  const { data } = useConversation(id ?? null)
  if (!id) return null
  if (data?.mode === 'chat') {
    return (
      <Suspense fallback={<Box sx={{ display: 'grid', flex: 1, placeItems: 'center', color: 'var(--muted)' }}><CircularProgress size={20} color="inherit" /></Box>}>
        <ChatConversationView key={id} id={id} />
      </Suspense>
    )
  }
  return <ConversationView key={id} id={id} adapters={ADAPTERS} />
}
