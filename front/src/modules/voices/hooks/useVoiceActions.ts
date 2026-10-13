/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { voiceKeys } from '../lib/voiceKeys'
import { voicesApi } from '../services/voicesApi'
import type { Voice } from '../types'

/** Deleting a voice (after confirming): the sample goes, the takes already generated with it stay. The list is re-read on success. */
export function useDeleteVoice() {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => voicesApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: voiceKeys.all }),
    onError: (error: Error) => void toast.error(error.message),
  })
  return async (voice: Pick<Voice, 'id' | 'name'>): Promise<void> => {
    const ok = await confirm({ titleId: 'voices.delete.title', messageId: 'voices.delete.message', params: [voice.name], confirmLabelId: 'voices.delete.confirm', danger: true })
    if (ok) remove.mutate(voice.id)
  }
}
