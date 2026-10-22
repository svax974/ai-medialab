/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Asset, GenParams, SendMessageRequest } from '@/modules/studio-core/types'
import { sendParams } from './params'

/** Body of `POST /api/messages` from the composer's state (no conversation: a new one is created). */
export function buildSendRequest(input: {
  conversationId: string | null
  prompt: string
  modelId: string
  params: GenParams
  seed: number | null
  references: readonly Pick<Asset, 'id'>[]
  count: number
}): SendMessageRequest {
  return {
    conversation_id: input.conversationId,
    prompt: input.prompt.trim(),
    model_id: input.modelId,
    params: sendParams(input.params, input.seed),
    reference_ids: input.references.map((reference) => reference.id),
    count: input.count,
  }
}
