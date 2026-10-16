/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useActiveModel, useModels, type ModelInfo } from '@/modules/model-catalog'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { chatKeys } from '../lib/chatKeys'
import { mergePatches, mergeSettings } from '../lib/settingsMerge'
import { chatApi } from '../services/chatApi'
import { useChatDefaultsStore } from '../state/chatDefaultsStore'
import { useChatDraftStore } from '../state/chatDraftStore'
import { useChatLiveStore } from '../state/chatLiveStore'
import { needsSettling } from '../lib/streamReducer'
import type { ChatConversation, ChatSettings, ChatSettingsPatch } from '../types'

const SETTINGS_DELAY_MS = 500
/** How often, and how many times, a message left `streaming` is read again (about a minute at most). */
const SETTLE_EVERY_MS = 1500
const SETTLE_TRIES = 40

/**
 * A chat conversation (active branch and settings). Kept fresh by the answer stream; the messages seen are remembered for
 * comparison. A message the server still holds as `streaming` while no answer is being read here (a stop that the server
 * has not settled yet, a page reloaded in the middle of an answer) is read again until it settles: it never stays stuck.
 */
export function useChatConversation(id: string | null) {
  const query = useQuery({ queryKey: chatKeys.conversation(id ?? ''), queryFn: () => chatApi.get(id as string), enabled: id !== null, staleTime: Infinity, refetchOnWindowFocus: false })
  const remember = useChatDraftStore((s) => s.remember)
  const reading = useChatLiveStore((s) => (id ? !!s.streams[id]?.active : false))
  const orphan = !reading && !!query.data && needsSettling(query.data)
  const refetch = query.refetch
  useEffect(() => {
    if (query.data) remember(query.data.messages)
  }, [query.data, remember])
  useEffect(() => {
    if (!orphan) return
    let tries = 0
    const timer = setInterval(() => {
      if (++tries > SETTLE_TRIES) clearInterval(timer)
      else void refetch()
    }, SETTLE_EVERY_MS)
    return () => clearInterval(timer)
  }, [orphan, refetch])
  return query
}

/**
 * The settings of a conversation, or the defaults of the home page (`id` null), and how to change them: a change shows at
 * once and is saved a moment later (one request for a burst of edits, e.g. a slider being dragged).
 */
export function useChatSettings(id: string | null): { settings: ChatSettings | null; update: (patch: ChatSettingsPatch) => void } {
  const queryClient = useQueryClient()
  const { data } = useChatConversation(id)
  const defaults = useChatDefaultsStore((s) => s.settings)
  const merge = useChatDefaultsStore((s) => s.merge)
  const pending = useRef<ChatSettingsPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const save = useMutation({
    mutationFn: (patch: ChatSettingsPatch) => chatApi.patchSettings(id as string, patch),
    onError: (error: Error) => {
      toast.error(error.message)
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(id ?? '') })
    },
  })
  const flush = useCallback(() => {
    if (!id || Object.keys(pending.current).length === 0) return
    const patch = pending.current
    pending.current = {}
    save.mutate(patch)
  }, [id, save])
  useEffect(() => () => { clearTimeout(timer.current); flush() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback(
    (patch: ChatSettingsPatch) => {
      if (!id) return merge(patch)
      queryClient.setQueryData<ChatConversation>(chatKeys.conversation(id), (c) => (c ? { ...c, settings: mergeSettings(c.settings, patch) } : c))
      pending.current = mergePatches(pending.current, patch)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, SETTINGS_DELAY_MS)
    },
    [id, merge, queryClient, flush],
  )
  return { settings: id ? (data?.settings ?? null) : defaults, update }
}

/** The chat model a conversation uses: its own choice when that model still exists, else the one the picker last selected. */
export function useChatModel(settings: ChatSettings | null): ModelInfo | undefined {
  const { data } = useModels()
  const active = useActiveModel('llm')
  const own = settings?.model_id ? data?.models.find((m) => m.id === settings.model_id && m.kind === 'llm') : undefined
  return own ?? active
}

/** Full-text search of the messages of every chat (the sidebar's search shows the excerpts); idle below two characters. */
export function useChatSearch(query: string) {
  const q = query.trim()
  return useQuery({ queryKey: chatKeys.search(q), queryFn: () => chatApi.search(q), enabled: q.length >= 2, staleTime: 30_000 })
}

/** After a conversation change the list must be read again (counts, order). */
export function useRefreshChatLists(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: studioKeys.conversations }), [queryClient])
}
