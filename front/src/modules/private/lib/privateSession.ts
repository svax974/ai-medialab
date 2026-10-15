/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { QueryClient } from '@tanstack/react-query'
import { privateApi } from '../services/privateApi'
import { usePrivateStore } from '../state/privateStore'
import { emptyContentStores, restoreContentStores } from './privacyStorage'
import { dropStudioCaches } from './privateTransition'

/**
 * Enters the private session. The flag flips FIRST: from that instant the stores that keep drafts neither read nor
 * write `localStorage`, so nothing typed afterwards can reach it. Then the composers are emptied, the caches of the
 * normal side dropped, and the server starts the session. If it cannot, everything goes back.
 */
export async function enterPrivate(queryClient: QueryClient): Promise<boolean> {
  const store = usePrivateStore.getState()
  if (store.active || store.busy) return store.active
  store.setBusy(true)
  store.setActive(true)
  emptyContentStores()
  dropStudioCaches(queryClient)
  try {
    usePrivateStore.getState().setInfo(await privateApi.start())
    return true
  } catch {
    await leaveLocally(queryClient)
    return false
  } finally {
    usePrivateStore.getState().setBusy(false)
  }
}

/** Back to the normal side without asking the server (it ended the session itself, or could not start one). */
export async function leaveLocally(queryClient: QueryClient): Promise<void> {
  emptyContentStores() // the flag is still on: nothing of what is emptied is written back
  usePrivateStore.getState().setActive(false)
  usePrivateStore.getState().setInfo(null)
  dropStudioCaches(queryClient)
  await restoreContentStores() // the drafts the user had typed before are read back, untouched
}

/** Ends the session on the server (files and memory erased), then returns to the normal side. */
export async function leavePrivate(queryClient: QueryClient): Promise<void> {
  usePrivateStore.getState().setBusy(true)
  try {
    await privateApi.end().catch(() => undefined) // an unreachable server erased nothing: it erases at its next start
    await leaveLocally(queryClient)
  } finally {
    usePrivateStore.getState().setBusy(false)
  }
}

/** Erases everything now and starts again with an empty session (the private mode stays on). */
export async function eraseNow(queryClient: QueryClient): Promise<void> {
  usePrivateStore.getState().setBusy(true)
  try {
    await privateApi.end()
    emptyContentStores()
    dropStudioCaches(queryClient)
    usePrivateStore.getState().setInfo(await privateApi.start())
  } finally {
    usePrivateStore.getState().setBusy(false)
  }
}
