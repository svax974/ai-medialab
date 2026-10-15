/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { QueryClient } from '@tanstack/react-query'
import { assetKeys } from '@/modules/media-library/lib/assetKeys'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { useLiveStore } from '@/modules/studio-core/state/liveStore'
import { useQueueStore } from '@/modules/studio-core/state/queueStore'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { forgetPrivateChats } from './privateChatMemory'

/**
 * Everything the screens hold that came from one side (normal or private) is dropped when the side changes: the
 * cached conversations and lists, the open viewer, the live progress and the queue. The two sides use the same cache
 * keys (same routes, one prefix apart), so without this a private conversation could be read back as a normal one.
 */
export function dropStudioCaches(queryClient: QueryClient): void {
  for (const queryKey of [studioKeys.conversations, studioKeys.conversationAll, assetKeys.all, studioKeys.modelUsage]) {
    queryClient.removeQueries({ queryKey })
  }
  useLightboxStore.getState().close()
  useLiveStore.setState(useLiveStore.getInitialState(), true)
  useQueueStore.setState(useQueueStore.getInitialState(), true)
  forgetPrivateChats() // the conversations of the private chat (memory only), their uploads, the answers being read
}
