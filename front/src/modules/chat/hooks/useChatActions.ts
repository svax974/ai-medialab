/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import type { ModelInfo } from '@/modules/model-catalog'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { attachmentRefs } from '../lib/attachments'
import { chatKeys } from '../lib/chatKeys'
import { requestedContext } from '../lib/context'
import { answerPaths, chatApi } from '../services/chatApi'
import { startAnswer, stopAnswer } from '../services/answerRunner'
import type { ChatConversation, ChatMessage, ChatSettings } from '../types'

/**
 * What the thread can do with a message: regenerate an answer (optionally with another model: the comparison), edit a
 * message (a new branch), show another branch, delete from a message on, stop the answer in progress.
 */
export function useChatActions(conversationId: string, settings: ChatSettings | null, model: ModelInfo | undefined) {
  const queryClient = useQueryClient()
  const context = settings ? requestedContext(settings, model) : null
  const setConversation = (conversation: ChatConversation) => {
    queryClient.setQueryData(chatKeys.conversation(conversationId), conversation)
    void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
  }
  const fail = (error: Error) => void toast.error(error.message)

  const regenerate = (message: ChatMessage, modelId?: string) => {
    const target = modelId ?? message.model_id ?? model?.id
    if (!target) return
    startAnswer(queryClient, conversationId, { path: answerPaths.regenerate(conversationId, message.id), body: { model_id: target }, modelId: target, requestedContext: context })
  }
  const edit = (message: ChatMessage, content: string) => {
    const target = message.model_id ?? model?.id ?? ''
    startAnswer(queryClient, conversationId, { path: answerPaths.edit(conversationId, message.id), body: { content, attachments: attachmentRefs(message.attachments) }, modelId: model?.id ?? target, requestedContext: context })
  }
  const switchBranch = (messageId: string) => {
    chatApi.setLeaf(conversationId, messageId).then(setConversation, fail)
  }
  const remove = async (message: ChatMessage) => {
    const ok = await confirm({ titleId: 'chat.delete.title', messageId: 'chat.delete.message', confirmLabelId: 'chat.delete.confirm', danger: true })
    if (ok) chatApi.removeMessage(conversationId, message.id).then(setConversation, fail)
  }
  return { regenerate, edit, switchBranch, remove, stop: () => stopAnswer(conversationId) }
}
