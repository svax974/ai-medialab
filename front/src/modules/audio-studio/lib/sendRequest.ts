/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { GenParams, SendMessageRequest } from '@/modules/studio-core'
import type { VoiceRef } from '@/modules/voices'

/**
 * Body of `POST /api/messages` for an audio generation: the model's parameters, the language and the seed (`null`: random);
 * the voice when there is one, the style or voice description when the model takes one, the cast of a dialogue (character
 * name to voice, only for the characters that got a voice). The server draws one seed per take.
 */
export function buildAudioRequest(input: {
  conversationId: string | null
  prompt: string
  model: Pick<ModelInfo, 'id' | 'audio'>
  params: GenParams
  language: string
  seed: number | null
  voice: VoiceRef | undefined
  instruct: string
  cast: Record<string, VoiceRef | undefined> | null
  count: number
}): SendMessageRequest {
  const body: GenParams = { ...input.params, language: input.language, seed: input.seed }
  if (input.voice) body['voice'] = input.voice
  if (input.model.audio?.instruct || input.model.audio?.design) body['instruct'] = input.instruct.trim()
  if (input.cast) body['cast'] = Object.fromEntries(Object.entries(input.cast).filter(([, voice]) => voice))
  return { conversation_id: input.conversationId, prompt: input.prompt.trim(), model_id: input.model.id, params: body, reference_ids: [], count: input.count }
}
