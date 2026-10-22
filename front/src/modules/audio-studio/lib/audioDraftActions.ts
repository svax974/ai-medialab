/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useModelSelectionStore } from '@/modules/model-catalog/state/modelSelectionStore'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import type { Message } from '@/modules/studio-core'
import { useAudioDraftStore } from '../state/audioDraftStore'
import { reusedAudio } from './takes'

/** "Reuse the text": the prompt of a user message goes back to the composer. */
export function reuseAudioPrompt(message: Pick<Message, 'prompt'>): void {
  useAudioDraftStore.getState().setPrompt(message.prompt)
  focusTarget('composer', true)
}

/** "Reuse text and settings": text, model, voice, language, style, parameters, number of takes and the first seed (pinned). */
export function reuseAudioSettings(message: Pick<Message, 'prompt' | 'model_id' | 'params'>): boolean {
  const settings = reusedAudio(message)
  if (!settings) return false
  const draft = useAudioDraftStore.getState()
  useModelSelectionStore.getState().select('audio', settings.modelId)
  draft.setPrompt(message.prompt)
  if (settings.voice) draft.setVoice(settings.modelId, settings.voice)
  if (settings.language) draft.setLanguage(settings.modelId, settings.language)
  if (settings.instruct !== undefined) draft.setInstruct(settings.modelId, settings.instruct)
  draft.setParams(settings.modelId, settings.params)
  if (settings.count) draft.setCount(settings.count)
  draft.setSeed(settings.seed)
  toast.success(i18n.get('audioStudio.settings.reused'), { autoClose: 1800 })
  focusTarget('composer', true)
  return true
}
