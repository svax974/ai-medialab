/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { Asset } from '@/modules/media-library/types'
import type { GenParams, SendMessageRequest } from '@/modules/studio-core'

type MeshModel = Pick<ModelInfo, 'id' | 'compatible' | 'ready' | 'requires_references' | 'reference_mode'>

/** The model controls which inputs are required; private sessions cannot create mesh jobs. */
export function canSendMesh(model: MeshModel, input: { prompt: string; reference: Asset | null; privateMode: boolean; busy: boolean }): boolean {
  if (input.privateMode || input.busy || !model.compatible || !model.ready) return false
  const hasReference = model.reference_mode !== 'none' && !!input.reference
  return model.requires_references ? hasReference : !!input.prompt.trim()
}

/** Build the single-output message expected by the shared generation queue. */
export function buildMeshRequest(input: { conversationId: string | null; prompt: string; model: MeshModel; reference: Asset | null; params: GenParams; seed: number | null }): SendMessageRequest {
  const reference = input.model.reference_mode !== 'none' ? input.reference : null
  return {
    conversation_id: input.conversationId,
    prompt: input.prompt.trim(),
    model_id: input.model.id,
    params: { ...input.params, seed: input.seed },
    reference_ids: reference ? [reference.id] : [],
    count: 1,
  }
}
