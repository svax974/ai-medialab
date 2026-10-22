/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { GenParams, SendMessageRequest } from '@/modules/studio-core/types'
import { videoRequirements, type VideoInputs } from './composerRules'

/** A video takes minutes to hours: two clips at most per request (the engine caps it too). */
export const MAX_CLIPS = 2

/**
 * Body of `POST /api/messages` for a video: the effective parameters and the seed (`null`: random), minus the parameters
 * that only mean something when editing a video (strength) when no source is attached; the references in the order the
 * engine reads them (start image, end image, source video), only those the model can use (the end image needs the start).
 */
export function buildVideoRequest(input: {
  conversationId: string | null
  prompt: string
  model: Pick<ModelInfo, 'id' | 'video' | 'params'>
  params: GenParams
  seed: number | null
  inputs: Pick<VideoInputs, 'start' | 'end' | 'source'>
  count: number
}): SendMessageRequest {
  const caps = input.model.video
  const { editing } = videoRequirements(input.model, input.inputs)
  const body: GenParams = { ...input.params, seed: input.seed }
  if (!editing) for (const spec of input.model.params) if (spec.requires_references) delete body[spec.key]
  const { start, end, source } = input.inputs
  const references: string[] = []
  if (start && caps && caps.image_input !== 'none') references.push(start.id)
  if (end && start && caps?.last_frame) references.push(end.id)
  if (source && caps && caps.video_input !== 'none') references.push(source.id)
  return { conversation_id: input.conversationId, prompt: input.prompt.trim(), model_id: input.model.id, params: body, reference_ids: references, count: Math.min(MAX_CLIPS, input.count) }
}
