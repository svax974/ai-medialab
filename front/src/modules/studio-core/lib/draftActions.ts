/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useModelSelectionStore } from '@/modules/model-catalog/state/modelSelectionStore'
import type { Asset, Message } from '../types'
import { useImageDraftStore } from '../state/imageDraftStore'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { reusedSettings } from './messageState'

/** Adds an image (generated or imported) as a reference of the next message, closes the viewer and focuses the composer. */
export function addAsReference(asset: Asset): void {
  useImageDraftStore.getState().addReferences([asset])
  useLightboxStore.getState().close()
  focusTarget('composer')
  toast.success(i18n.get('thread.reference.added'), { autoClose: 1800 })
}

/** "Reuse in the composer": the prompt and the references of a user message replace the draft. */
export function reuseUserMessage(message: Pick<Message, 'prompt' | 'references'>): void {
  const draft = useImageDraftStore.getState()
  draft.setPrompt(message.prompt)
  draft.clearReferences()
  draft.addReferences(message.references)
  focusTarget('composer', true)
}

/** "Reuse these settings": model, parameters, number of images and the first seed (pinned) come back to the composer. */
export function reuseGenerationSettings(message: Pick<Message, 'model_id' | 'params'>): boolean {
  const settings = reusedSettings(message)
  if (!settings) return false
  const draft = useImageDraftStore.getState()
  useModelSelectionStore.getState().select('image', settings.modelId)
  draft.setParams(settings.modelId, settings.params)
  if (settings.count) draft.setCount(settings.count)
  draft.setSeed(settings.seed)
  toast.success(i18n.get('thread.settings.reused'), { autoClose: 1800 })
  focusTarget('composer')
  return true
}
