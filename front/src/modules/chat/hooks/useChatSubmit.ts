/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import type { ModelInfo } from '@/modules/model-catalog'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { attachmentRefs, MAX_CONTENT_CHARS } from '../lib/attachments'
import { requestedContext } from '../lib/context'
import { answerPaths, chatApi } from '../services/chatApi'
import { startAnswer } from '../services/answerRunner'
import { useCreationModels } from './useCreationModels'
import { withCreation } from '../lib/creation'
import { useChatDefaultsStore } from '../state/chatDefaultsStore'
import { HOME_DRAFT, useChatDraftStore } from '../state/chatDraftStore'
import type { ChatAttachment, ChatSettings, SendBody } from '../types'

/**
 * Sends the message of a composer. In a conversation the answer streams into it at once; from the home page the
 * conversation is created first, given the settings of the home page, and opened: the page there takes the send over
 * (`pending`) once it has loaded the conversation, so the stream lands in a cache that exists.
 */
export function useChatSubmit(conversationId: string | null, settings: ChatSettings | null, model: ModelInfo | undefined) {
  const creation = useCreationModels()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const submit = async (text: string, attached: ChatAttachment[]): Promise<void> => {
    if (!model || !settings) return
    if (text.length > MAX_CONTENT_CHARS) return void toast.error(i18n.get('chat.error.tooLong', [MAX_CONTENT_CHARS]))
    const body: SendBody = { content: text.trim(), attachments: attachmentRefs(attached), model_id: model.id, ...withCreation(settings, creation) }
    const context = requestedContext(settings, model)
    if (conversationId) {
      startAnswer(queryClient, conversationId, { path: answerPaths.send(conversationId), body, draftKey: conversationId, modelId: model.id, requestedContext: context })
      return
    }
    setCreating(true)
    try {
      const defaults = useChatDefaultsStore.getState().settings
      const created = await chatApi.createConversation()
      await chatApi.patchSettings(created.id, { model_id: model.id, system_prompt: defaults.system_prompt, params: defaults.params, context_size: defaults.context_size, reasoning: defaults.reasoning, tools: defaults.tools })
      useChatDraftStore.getState().setPending({ conversationId: created.id, body, draftKey: HOME_DRAFT, modelId: model.id, requestedContext: context })
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
      navigate(studioPaths.conversation(created.id))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCreating(false)
    }
  }
  return { submit, creating }
}
