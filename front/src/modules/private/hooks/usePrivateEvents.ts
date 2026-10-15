/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { messagesApi } from '@/modules/studio-core/services/messagesApi'
import { useQueueStore } from '@/modules/studio-core/state/queueStore'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { leaveLocally } from '../lib/privateSession'
import { privateApi } from '../services/privateApi'
import { usePrivateStore } from '../state/privateStore'

/** Topic of Nest's private events: only a kind and ids, never a prompt, a title or a file name. */
export const PRIVATE_TOPIC = 'private.changed'
const COALESCE_MS = 250

/**
 * Keeps the private side in step with the server while the session is on: what changed (conversations, messages,
 * the queue, the results count) is read again from `/api/private/*`; a session the server ended (inactivity timeout)
 * brings the interface back to the normal side with a message. Does nothing in the normal mode.
 */
export function usePrivateEvents(): void {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      timer = undefined
      if (!usePrivateStore.getState().active) return
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversationAll })
      messagesApi.queue().then((state) => useQueueStore.getState().set(state), () => undefined)
      const info = await privateApi.info().catch(() => null)
      if (!info || !usePrivateStore.getState().active) return
      if (info.active) {
        usePrivateStore.getState().setInfo(info)
        return
      }
      await leaveLocally(queryClient) // the server ended the session (timeout)
      toast.info(i18n.get('private.expired'))
      navigate('/', { replace: true })
    }
    const unsubscribe = eventStreamClient.subscribe(
      [PRIVATE_TOPIC],
      () => {
        if (usePrivateStore.getState().active) timer ??= setTimeout(() => void refresh(), COALESCE_MS)
      },
      { onResync: () => void refresh() },
    )
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [queryClient, navigate])
}
