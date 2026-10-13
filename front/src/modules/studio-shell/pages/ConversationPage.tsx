/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useParams } from 'react-router-dom'
import { audioStudioAdapter } from '@/modules/audio-studio'
import { imageStudioAdapter } from '@/modules/image-studio'
import { ConversationView, type ModeAdapters } from '@/modules/studio-core'

/** Adapters of the creation modes that have their studio (image: H4.3, audio: H4.5); video joins with H4.6. */
const ADAPTERS: ModeAdapters = { image: imageStudioAdapter, audio: audioStudioAdapter }

/** `/c/:id`: the conversation thread of `studio-core` with the composer of the conversation's mode. */
export function ConversationPage() {
  const { id } = useParams()
  return id ? <ConversationView key={id} id={id} adapters={ADAPTERS} /> : null
}
