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
import { addOutput, upsertMessage } from '@/modules/studio-core'
import type { ConversationDetail } from '@/modules/studio-core'
import { renderMermaid, svgToPng } from '../lib/renderDiagram'
import { diagramsApi } from '../services/diagramsApi'
import { useDiagramDraftStore } from '../state/diagramDraftStore'
import type { DiagramTheme, DiagramType, GenerateDiagramResponse } from '../types'
import type { Asset } from '@/modules/media-library'

export interface SendDiagramInput {
  prompt: string
  modelId: string
  diagramType: DiagramType
  theme: DiagramTheme
}

/**
 * Sends the prompt, waits for the whole result (structured generation, then client-side Mermaid → PNG render, then
 * the upload that attaches it to the message) before resolving: from the composer's point of view this is one
 * action, like an image generation, not a chat reply that streams text first and an image later. No job queue, no
 * SSE: see `back/src/modules/diagrams/README.md`.
 */
export function useSendDiagram(conversationId: string | null) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async (input: SendDiagramInput): Promise<{ response: GenerateDiagramResponse; asset: Asset }> => {
      const response = await diagramsApi.generate({
        conversation_id: conversationId, prompt: input.prompt, model_id: input.modelId, diagram_type: input.diagramType,
      })
      const svg = await renderMermaid(response.mermaid_source, input.theme)
      const { blob } = await svgToPng(svg)
      const asset = await diagramsApi.render(response.assistant_message.id, blob, response.diagram_type)
      return { response, asset }
    },
    onSuccess: async ({ response, asset }) => {
      useDiagramDraftStore.getState().setPrompt('')
      if (conversationId) {
        queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(conversationId), (conversation) => {
          if (!conversation) return conversation
          const withMessages = upsertMessage(upsertMessage(conversation, response.user_message), response.assistant_message)
          return addOutput(withMessages, response.assistant_message.id, asset)
        })
      } else {
        await queryClient.prefetchQuery({ queryKey: studioKeys.conversation(response.conversation_id), queryFn: () => conversationsApi.get(response.conversation_id) })
        navigate(studioPaths.conversation(response.conversation_id))
      }
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
    },
    onError: (error: Error) => void toast.error(error.message),
  })
}
