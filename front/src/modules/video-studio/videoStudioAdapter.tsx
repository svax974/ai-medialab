/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModeAdapter } from '@/modules/studio-core'
import { VideoAssistantMessage } from './components/VideoAssistantMessage'
import { VideoComposer } from './components/VideoComposer'
import { reuseVideoPrompt } from './lib/videoDraftActions'

/** What the video mode plugs into the conversation thread of `studio-core`. */
export const videoStudioAdapter: ModeAdapter = {
  kind: 'video',
  Composer: ({ conversationId }) => <VideoComposer conversationId={conversationId} />,
  AssistantMessage: VideoAssistantMessage,
  reuseUserMessage: reuseVideoPrompt,
}
