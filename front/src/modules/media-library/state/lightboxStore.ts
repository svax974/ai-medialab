/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import type { Asset } from '../types'

/** The viewer's list and position, opened from anywhere (a tile, a reference, the recent images). */
interface LightboxState {
  items: Asset[]
  index: number
  open: boolean
  show: (items: Asset[], index: number) => void
  close: () => void
  setIndex: (index: number) => void
  /** An asset changed (favorite): replace it in the list. */
  patch: (asset: Asset) => void
  /** An asset was deleted from the viewer: drop it and keep the position valid; closes when nothing is left. */
  drop: (id: string) => void
}

export const useLightboxStore = create<LightboxState>()((set) => ({
  items: [],
  index: 0,
  open: false,
  show: (items, index) => set(items.length > 0 ? { items, index: Math.max(0, Math.min(index, items.length - 1)), open: true } : {}),
  close: () => set({ open: false, items: [], index: 0 }),
  setIndex: (index) => set((state) => ({ index: Math.max(0, Math.min(index, state.items.length - 1)) })),
  patch: (asset) => set((state) => (state.items.some((a) => a.id === asset.id) ? { items: state.items.map((a) => (a.id === asset.id ? { ...a, ...asset } : a)) } : state)),
  drop: (id) =>
    set((state) => {
      const items = state.items.filter((a) => a.id !== id)
      return items.length === 0 ? { open: false, items: [], index: 0 } : { items, index: Math.min(state.index, items.length - 1) }
    }),
}))
