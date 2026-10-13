/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { assetsApi } from '@/modules/media-library'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '@/modules/studio-core'
import { useVoiceStudioStore, voiceKeys, voicesApi } from '@/modules/voices'
import { audioDownloadName, voiceFromTake } from '../lib/takes'
import { VoiceSavedToast } from '../components/VoiceSavedToast'

/** Downloads a take as a WAV through a temporary link (the file is served by the same origin). */
export function downloadTake(asset: Asset): void {
  const link = document.createElement('a')
  link.href = resolveMediaUrl(asset.url)
  link.download = audioDownloadName(asset)
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * "Keep as a reference voice": the take becomes a library voice (the engine prepares the clip), and a message offers to
 * edit it (name, transcript). The studio then fills the transcript from what was said, which the user can correct.
 */
export function useSaveTakeAsVoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (asset: Asset) => voicesApi.fromAsset(voiceFromTake(asset, { copy: (name) => i18n.get('audioStudio.take.voiceCopy', [name]), created: i18n.get('audioStudio.take.voiceCreated') })),
    onSuccess: (voice) => {
      void queryClient.invalidateQueries({ queryKey: voiceKeys.all })
      toast.success(createElement(VoiceSavedToast, { name: voice.name, onEdit: () => useVoiceStudioStore.getState().open({ voiceId: voice.id }) }))
    },
    onError: (error: Error) => void toast.error(error.message),
  })
}

/** Deleting a take (after confirming): the file goes; the server's `studio.asset.deleted` event updates the thread. */
export function useDeleteTake() {
  const remove = useMutation({ mutationFn: (id: string) => assetsApi.remove(id), onError: (error: Error) => void toast.error(error.message) })
  return async (asset: Pick<Asset, 'id'>): Promise<void> => {
    const ok = await confirm({ titleId: 'audioStudio.take.delete.title', messageId: 'audioStudio.take.delete.message', confirmLabelId: 'audioStudio.take.delete.confirm', danger: true })
    if (ok) remove.mutate(asset.id)
  }
}
