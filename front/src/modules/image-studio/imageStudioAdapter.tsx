/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { AssistantMessage, reuseUserMessage, type ModeAdapter } from '@/modules/studio-core'
import { Composer } from './components/Composer'

/** What the image mode plugs into the conversation thread of `studio-core`. */
export const imageStudioAdapter: ModeAdapter = {
  kind: 'image',
  Composer: ({ conversationId }) => <Composer conversationId={conversationId} />,
  AssistantMessage,
  reuseUserMessage,
}
