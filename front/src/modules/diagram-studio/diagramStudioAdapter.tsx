/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { AssistantMessage, reuseUserMessage, type ModeAdapter } from '@/modules/studio-core'
import { Composer } from './components/Composer'

/** What the diagram mode plugs into the conversation thread of `studio-core`. A rendered diagram is stored as a
 * plain generated image asset (`kind: 'generated', media: 'image'`, see `back/src/modules/diagrams/README.md`), so
 * the generic image tile, gallery and lightbox apply unchanged — no bespoke `AssistantMessage` needed here. */
export const diagramStudioAdapter: ModeAdapter = {
  kind: 'diagram',
  Composer: ({ conversationId }) => <Composer conversationId={conversationId} />,
  AssistantMessage,
  reuseUserMessage,
}
