/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { enqueueItems, setItemStatus } from '../lib/queue'
import type { UpdateItem, UpdateItemStatus } from '../types'

/** The dialog's open flag and the updates asked for. The queue lives here, not in the dialog: closing it does not stop the updates. */
interface UpdatesState {
  open: boolean
  queue: UpdateItem[]
  setOpen: (open: boolean) => void
  enqueue: (items: UpdateItem[]) => void
  setStatus: (key: string, status: UpdateItemStatus, error?: string | null) => void
  /** Forgets the finished items (done or failed). */
  clearFinished: () => void
}

export const useUpdatesStore = create<UpdatesState>()((set) => ({
  open: false,
  queue: [],
  setOpen: (open) => set({ open }),
  enqueue: (items) => set((s) => ({ queue: enqueueItems(s.queue, items) })),
  setStatus: (key, status, error = null) => set((s) => ({ queue: setItemStatus(s.queue, key, status, error) })),
  clearFinished: () => set((s) => ({ queue: s.queue.filter((i) => i.status === 'queued' || i.status === 'running') })),
}))
