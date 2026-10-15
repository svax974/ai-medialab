/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { forgetPrivateChat } from '@/modules/private/lib/privateChatMemory'
import { studioKeys } from '../lib/queryKeys'
import { conversationsApi } from '../services/conversationsApi'
import type { ConversationPatch, ConversationSummary, StudioMode } from '../types'

export function useConversationList(mode: StudioMode, query: string) {
  return useQuery({
    queryKey: studioKeys.conversationList(mode, query),
    queryFn: () => conversationsApi.list(query, mode),
  })
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: studioKeys.conversation(id ?? ''),
    queryFn: () => conversationsApi.get(id as string),
    enabled: id !== null,
  })
}

/** Applies a patch to every cached list entry of a conversation (optimistic update). */
function patchLists(lists: [readonly unknown[], ConversationSummary[] | undefined][], id: string, patch: ConversationPatch) {
  return lists.map(([key, data]) => [key, data?.map((c) => (c.id === id ? { ...c, ...patch } : c))] as const)
}

/** Pin / rename (optimistic, rolled back on error), delete of a conversation and of several at once. */
export function useConversationActions() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: studioKeys.conversations })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConversationPatch }) => conversationsApi.patch(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: studioKeys.conversations })
      const previous = queryClient.getQueriesData<ConversationSummary[]>({ queryKey: studioKeys.conversations })
      for (const [key, data] of patchLists(previous, id, patch)) queryClient.setQueryData(key, data)
      return { previous }
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data)
      toast.error(i18n.get('studio.conversation.error.update'))
    },
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: string) => conversationsApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: studioKeys.conversation(id) })
      forgetPrivateChat(id) // a private chat conversation lives only in this page's memory: deleting it forgets it
    },
    onError: () => toast.error(i18n.get('studio.conversation.error.delete')),
    onSettled: refresh,
  })

  // One request after the other: each deletion removes files, and a failure must not leave the rest half done.
  const removeMany = useMutation({
    mutationFn: async (ids: string[]) => {
      const done: string[] = []
      for (const id of ids) {
        try {
          await conversationsApi.remove(id)
          done.push(id)
        } catch {
          // reported once, with the count, by onSettled
        }
      }
      return { done, failed: ids.length - done.length }
    },
    onSuccess: ({ done, failed }) => {
      for (const id of done) {
        queryClient.removeQueries({ queryKey: studioKeys.conversation(id) })
        forgetPrivateChat(id)
      }
      if (failed > 0) toast.error(i18n.get('studio.conversation.error.deleteMany', [failed]))
    },
    onSettled: refresh,
  })

  return { update, remove, removeMany }
}
