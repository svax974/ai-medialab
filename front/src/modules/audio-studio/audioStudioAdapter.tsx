/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModeAdapter } from '@/modules/studio-core'
import { AudioAssistantMessage } from './components/AudioAssistantMessage'
import { AudioComposer } from './components/AudioComposer'
import { reuseAudioPrompt } from './lib/audioDraftActions'

/** What the audio mode plugs into the conversation thread of `studio-core`. */
export const audioStudioAdapter: ModeAdapter = {
  kind: 'audio',
  Composer: ({ conversationId }) => <AudioComposer conversationId={conversationId} />,
  AssistantMessage: AudioAssistantMessage,
  reuseUserMessage: reuseAudioPrompt,
}
