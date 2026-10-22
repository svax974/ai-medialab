/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { patchAssetInData, removeAssetFromData, type AssetListData } from '@/modules/media-library/lib/assetCache'
import { messagesApi } from '../services/messagesApi'
import { STUDIO_TOPICS, opsOfStudioEvent, patchAssetInConversation, type StudioOp } from '../lib/studioEvents'
import { assetKeys } from '@/modules/media-library/lib/assetKeys'
import type { Asset, ConversationDetail } from '../types'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { useLiveStore } from '../state/liveStore'
import { useQueueStore } from '../state/queueStore'

/** Lists are refreshed at most once per window: a generation emits many events in a burst. */
const COALESCE_MS = 250

function applyAssetDeleted(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<AssetListData>({ queryKey: assetKeys.all }, (data) => (data ? removeAssetFromData(data, id) : data))
  if (useLightboxStore.getState().items.some((a) => a.id === id)) useLightboxStore.getState().drop(id)
}

/** Reads the queue once (reload, reconnection): positions are known from then on, `studio.queue.updated` keeps them current. */
function loadQueue(): void {
  messagesApi.queue().then(
    (state) => useQueueStore.getState().set(state),
    () => undefined, // the next event sets it; until then no position is shown
  )
}

function applyAsset(queryClient: QueryClient, asset: Asset): void {
  if (asset.conversation_id) {
    queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(asset.conversation_id), (conversation) => (conversation ? patchAssetInConversation(conversation, asset) : conversation))
  }
  queryClient.setQueriesData<AssetListData>({ queryKey: assetKeys.all }, (data) => (data ? patchAssetInData(data, asset) : data))
  useLightboxStore.getState().patch(asset)
}

/** Applies one operation; invalidations are returned to be coalesced by the caller. */
export function applyStudioOp(queryClient: QueryClient, op: StudioOp): readonly unknown[] | null {
  switch (op.type) {
    case 'conversation':
      queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(op.id), (conversation) => (conversation ? op.update(conversation) : conversation))
      return null
    case 'progress':
      useLiveStore.getState().setProgress(op.progress)
      return null
    case 'clearProgress':
      useLiveStore.getState().clearProgress(op.messageId)
      return null
    case 'asset':
      applyAsset(queryClient, op.asset)
      return null
    case 'assetDeleted':
      applyAssetDeleted(queryClient, op.id)
      return null
    case 'queue':
      useQueueStore.getState().set(op.state)
      return null
    case 'remove':
      queryClient.removeQueries({ queryKey: op.key })
      return null
    case 'invalidate':
      return op.key
  }
}

/**
 * Keeps the query cache and the live progress in step with the `studio.*` events of Nest (one subscription per tab,
 * shared with the other consumers of the stream): messages and images are written into the cached conversation as they
 * arrive (no re-read), the lists are invalidated (coalesced), the progress goes to the live store.
 * A reconnection that cannot be replayed (`resync`) re-reads the conversations.
 */
export function useStudioEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: (readonly unknown[])[] = []
    const flush = () => {
      const keys = pending
      pending = []
      timer = undefined
      const seen = new Set<string>()
      for (const queryKey of keys) {
        const id = JSON.stringify(queryKey)
        if (seen.has(id)) continue
        seen.add(id)
        void queryClient.invalidateQueries({ queryKey })
      }
    }
    const schedule = (key: readonly unknown[]) => {
      pending.push(key)
      timer ??= setTimeout(flush, COALESCE_MS)
    }
    loadQueue()
    const unsubscribe = eventStreamClient.subscribe(
      [...STUDIO_TOPICS],
      (event) => {
        for (const op of opsOfStudioEvent(event)) {
          const key = applyStudioOp(queryClient, op)
          if (key) schedule(key)
        }
      },
      {
        onResync: () => {
          schedule(studioKeys.conversations)
          schedule(studioKeys.conversationAll)
          schedule(assetKeys.all)
          loadQueue()
        },
      },
    )
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [queryClient])
}
