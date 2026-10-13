/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useParams } from 'react-router-dom'
import { imageStudioAdapter } from '@/modules/image-studio'
import { ConversationView, type ModeAdapters } from '@/modules/studio-core'

/** Adapters of the creation modes that have their studio; audio and video join with H4.5 and H4.6. */
const ADAPTERS: ModeAdapters = { image: imageStudioAdapter }

/** `/c/:id`: the conversation thread of `studio-core` with the composer of the conversation's mode. */
export function ConversationPage() {
  const { id } = useParams()
  return id ? <ConversationView key={id} id={id} adapters={ADAPTERS} /> : null
}
