/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { conversationsApi } from '@/modules/studio-shell/services/conversationsApi'
import { messagesApi, upsertMessage } from '@/modules/studio-core'
import type { ConversationDetail, SendMessageRequest } from '@/modules/studio-core'
import { useAudioDraftStore } from '../state/audioDraftStore'

/**
 * Sends the text. On success the draft text is emptied; in a conversation the two new messages (the text and its queued
 * synthesis) are written into the cache at once, the `studio.*` events following; from the home page the new
 * conversation is loaded first, then opened, so that it appears with its messages without a flash.
 */
export function useSendAudio(conversationId: string | null) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (request: SendMessageRequest) => messagesApi.send(request),
    onSuccess: async (response) => {
      useAudioDraftStore.getState().setPrompt('')
      if (conversationId) {
        queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(conversationId), (conversation) =>
          conversation ? upsertMessage(upsertMessage(conversation, response.user_message), response.assistant_message) : conversation,
        )
      } else {
        await queryClient.prefetchQuery({ queryKey: studioKeys.conversation(response.conversation_id), queryFn: () => conversationsApi.get(response.conversation_id) })
        navigate(studioPaths.conversation(response.conversation_id))
      }
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
    },
    onError: (error: Error) => void toast.error(error.message),
  })
}
