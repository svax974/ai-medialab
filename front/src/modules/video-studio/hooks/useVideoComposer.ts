/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import { videoNotices, videoRequirements, videoSendState, visibleSlots } from '../lib/composerRules'
import { buildVideoRequest } from '../lib/sendRequest'
import { effectiveVideoParams } from '../lib/videoMath'
import { useVideoDraftStore } from '../state/videoDraftStore'
import { useSendVideo } from './useSendVideo'

/**
 * Everything the video composer shows and sends for a model: the effective parameters, what is attached and which slots to
 * draw, whether the clip can be requested (and what the button's tooltip says), the notices, and `submit`.
 */
export function useVideoComposer(model: ModelInfo, conversationId: string | null) {
  const draft = useVideoDraftStore()
  const send = useSendVideo(conversationId)
  const params = effectiveVideoParams(model, draft.paramsByModel[model.id])
  const inputs = { start: draft.start, end: draft.end, source: draft.source, uploading: draft.uploads.length }
  const { editing } = videoRequirements(model, inputs)
  const state = videoSendState(model, inputs, { prompt: draft.prompt, sending: send.isPending })

  const submit = () => {
    if (!state.canSend) return
    send.mutate(buildVideoRequest({ conversationId, prompt: draft.prompt, model, params, seed: draft.seed, inputs, count: draft.count }))
  }

  return {
    draft,
    params,
    inputs,
    editing,
    state,
    submit,
    sending: send.isPending,
    notices: videoNotices(model, inputs),
    slots: visibleSlots(model, inputs, draft.uploads.map((upload) => upload.slot)),
  }
}
