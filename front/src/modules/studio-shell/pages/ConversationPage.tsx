/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useParams } from 'react-router-dom'
import { useConversation } from '../hooks/useConversations'
import { ComingSoonPage } from './ComingSoonPage'

/** `/c/:id`: the conversation view arrives with H4.3; for now the title of the conversation, once loaded. */
export function ConversationPage() {
  const { id } = useParams()
  const { data } = useConversation(id ?? null)
  return <ComingSoonPage titleKey="studio.page.conversation.title" title={data?.title} />
}
