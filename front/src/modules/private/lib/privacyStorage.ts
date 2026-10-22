/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware'
import { isPrivateMode } from '../state/privateStore'

/** The browser's `localStorage` when it can be used (private windows, blocked site data and previews may refuse it). */
function local(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

/**
 * `localStorage` for the stores that keep what the user typed (drafts, remembered settings): while a private session
 * is on, nothing is read from it (the composers start empty) and nothing is written to it. A write attempted by a
 * store during the session is dropped, so the normal drafts stay as they were.
 */
export const privacyStateStorage: StateStorage = {
  getItem: (name) => {
    if (isPrivateMode()) return null
    try {
      return local()?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    if (isPrivateMode()) return
    try {
      local()?.setItem(name, value)
    } catch {
      // quota or blocked storage: the draft is simply not remembered
    }
  },
  removeItem: (name) => {
    if (isPrivateMode()) return
    try {
      local()?.removeItem(name)
    } catch {
      // nothing to remove
    }
  },
}

/** The `storage` option of a persisted store that holds user content. */
export function privacyStorage<S>(): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => privacyStateStorage)
}

/** What a persisted store offers (Zustand's `persist` middleware): enough to empty it and to read it back. */
export interface PrivacyAwareStore {
  getInitialState: () => unknown
  setState: (state: never, replace: true) => void
  persist: { rehydrate: () => Promise<void> | void }
}

const registry = new Set<PrivacyAwareStore>()

/** Registers a persisted store that holds user content: it is emptied when a private session starts and read back when it ends. */
export function registerPrivacyStore<T extends PrivacyAwareStore>(store: T): T {
  registry.add(store)
  return store
}

function reset(store: PrivacyAwareStore): void {
  store.setState(store.getInitialState() as never, true)
}

/** Empties every registered store in memory (writes are dropped while the session is on: call it before and after the flag flips accordingly). */
export function emptyContentStores(): void {
  registry.forEach(reset)
}

/**
 * After a private session: the stores read what the user had typed before it (from `localStorage`, which was never
 * touched). Call it AFTER the flag went off and after `emptyContentStores()` ran while it was still on: emptying a store
 * once the flag is off would write the empty state over the drafts.
 */
export async function restoreContentStores(): Promise<void> {
  await Promise.all([...registry].map((store) => store.persist.rehydrate()))
}
