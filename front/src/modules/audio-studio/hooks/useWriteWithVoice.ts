/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useActiveModel, useModelSelectionStore, useModels } from '@/modules/model-catalog'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import type { Voice } from '@/modules/voices'
import { modelForVoice, speaksLanguage } from '../lib/cloner'
import { useAudioDraftStore } from '../state/audioDraftStore'

/**
 * "Write with this voice" (a button of the voice library): picks the model (the active one if it can clone, else the best
 * cloning one), selects the voice and its language in the composer, opens the audio home and focuses the text. An error message
 * when no model can clone on this machine.
 */
export function useWriteWithVoice(): (voice: Voice) => void {
  const { data: catalog } = useModels()
  const active = useActiveModel('audio')
  const navigate = useNavigate()
  return (voice) => {
    const model = modelForVoice(catalog?.models ?? [], active)
    if (!model) {
      toast.error(i18n.get('audioStudio.writeWith.noModel'))
      return
    }
    const draft = useAudioDraftStore.getState()
    useModelSelectionStore.getState().select('audio', model.id)
    draft.setVoice(model.id, { source: 'library', id: voice.id })
    if (speaksLanguage(model, voice.language)) draft.setLanguage(model.id, voice.language)
    navigate(studioPaths.audioHome)
    focusTarget('composer')
    toast.success(i18n.get('audioStudio.writeWith.done', [voice.name, model.name]), { autoClose: 2200 })
  }
}
