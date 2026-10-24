/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { upsertMessage } from '../lib/studioEvents'
import { messagesApi } from '../services/messagesApi'
import type { ConversationDetail, Message } from '../types'

const showError = (error: Error) => void toast.error(error.message)

/** Kind of creation, for the texts of the confirmation. */
export type MessageKind = 'image' | 'audio' | 'video' | 'diagram'

/**
 * Actions on the messages of a conversation: new variants (new seeds) and same-seed retry, cancel, delete (with
 * confirmation). The server's answer to a retry is written into the cache at once; the `studio.*` events follow.
 * Errors are the server's own messages (French, shown as they come).
 */
export function useMessageActions() {
  const queryClient = useQueryClient()
  const cacheMessage = (message: Message) =>
    queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(message.conversation_id), (conversation) => (conversation ? upsertMessage(conversation, message) : conversation))

  const retry = useMutation({
    mutationFn: ({ id, keepSeed, forceMemory }: { id: string; keepSeed?: boolean; forceMemory?: boolean }) =>
      messagesApi.retry(id, { ...(keepSeed ? { keep_seed: true } : {}), ...(forceMemory ? { force_memory: true } : {}) }),
    onSuccess: cacheMessage,
    onError: showError,
  })
  const cancel = useMutation({ mutationFn: (id: string) => messagesApi.cancel(id), onError: showError })
  const remove = useMutation({ mutationFn: (id: string) => messagesApi.remove(id), onError: showError })

  /** Asks, then deletes. A prompt takes its generations with it (`kind` picks the wording). */
  const confirmRemove = async (message: Pick<Message, 'id' | 'role'>, kind: MessageKind): Promise<void> => {
    const user = message.role === 'user'
    const ok = await confirm({
      titleId: user ? 'thread.deleteMessage.title' : `thread.deleteGeneration.title.${kind}`,
      messageId: user ? `thread.deleteMessage.description.${kind}` : `thread.deleteGeneration.description.${kind}`,
      confirmLabelId: 'thread.delete',
      danger: true,
    })
    if (ok) remove.mutate(message.id)
  }

  /** After a refusal for lack of free memory: asks to be sure, then runs the same generation without that check. */
  const confirmContinueAnyway = async (message: Pick<Message, 'id'>): Promise<void> => {
    const ok = await confirm({
      titleId: 'thread.forceMemory.title',
      messageId: 'thread.forceMemory.description',
      confirmLabelId: 'thread.forceMemory.confirm',
      danger: true,
    })
    if (ok) retry.mutate({ id: message.id, keepSeed: true, forceMemory: true })
  }

  return { retry, cancel, remove, confirmRemove, confirmContinueAnyway }
}
