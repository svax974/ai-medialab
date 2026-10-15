/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { PrivateSessionInfo } from '../types'

/**
 * Whether the private generation session is on, and what the banner shows of it. NEVER persisted (no `persist`, no
 * storage): a page that opens always starts in normal mode, and everything that reads this flag (the storage of the
 * stores that keep drafts, the routing of the studio requests) does it synchronously through `isPrivateMode()`.
 */
interface PrivateState {
  active: boolean
  /** Starting or ending: the toggle waits. */
  busy: boolean
  info: PrivateSessionInfo | null
  setActive: (active: boolean) => void
  setBusy: (busy: boolean) => void
  setInfo: (info: PrivateSessionInfo | null) => void
}

export const usePrivateStore = create<PrivateState>()((set) => ({
  active: false,
  busy: false,
  info: null,
  setActive: (active) => set({ active }),
  setBusy: (busy) => set({ busy }),
  setInfo: (info) => set({ info }),
}))

/** For code outside React (storage adapters, the HTTP layer): true while a private session is on. */
export const isPrivateMode = (): boolean => usePrivateStore.getState().active
