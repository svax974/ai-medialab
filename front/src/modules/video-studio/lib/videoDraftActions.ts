/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useModelSelectionStore } from '@/modules/model-catalog/state/modelSelectionStore'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import type { Asset, Message } from '@/modules/studio-core/types'
import { useVideoDraftStore } from '../state/videoDraftStore'
import { reusedVideo } from './clips'

/** Puts the inputs of a prompt back in the composer's slots: images in order (start, end), the video as the source; the others are emptied. */
function restoreSlots(references: readonly Asset[]): void {
  const draft = useVideoDraftStore.getState()
  draft.clearSlots()
  const images = references.filter((ref) => ref.media !== 'video')
  if (images[0]) draft.setSlot('start', images[0])
  if (images[1]) draft.setSlot('end', images[1])
  const clip = references.find((ref) => ref.media === 'video')
  if (clip) draft.setSlot('source', clip)
}

/** "Reuse in the composer": the prompt of a user message and its start image, end image and source video replace the draft. */
export function reuseVideoPrompt(message: Pick<Message, 'prompt' | 'references'>): void {
  useVideoDraftStore.getState().setPrompt(message.prompt)
  restoreSlots(message.references)
  focusTarget('composer', true)
}

/**
 * "Reuse these settings": model, prompt, parameters, number of clips and the first seed (pinned), with the inputs of the prompt
 * that started the generation (found among the messages of the conversation). `false` when the generation has no model.
 */
export function reuseVideoSettings(message: Message, siblings: readonly Message[]): boolean {
  const parent = siblings.find((candidate) => candidate.id === message.parent_id)
  const settings = reusedVideo(message, parent?.references ?? [])
  if (!settings) return false
  const draft = useVideoDraftStore.getState()
  useModelSelectionStore.getState().select('video', settings.modelId)
  draft.setPrompt(settings.prompt)
  draft.setParams(settings.modelId, settings.params)
  if (settings.count) draft.setCount(settings.count)
  draft.setSeed(settings.seed)
  restoreSlots([settings.start, settings.end, settings.source].filter((asset): asset is Asset => asset !== null))
  toast.success(i18n.get('videoStudio.settings.reused'), { autoClose: 1800 })
  focusTarget('composer')
  return true
}
