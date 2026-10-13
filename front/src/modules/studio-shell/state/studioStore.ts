/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_LAST_PATHS } from '../lib/routes'
import type { StudioMode } from '../types'

/**
 * Client state of the studio (Zustand): what has no server counterpart. Server data lives in TanStack Query.
 * H4 modules extend this store with their own slices (composer drafts, lightbox...).
 */
interface StudioState {
  /** Mode of the current page (follows the route, see useModeSync). */
  mode: StudioMode
  setMode: (mode: StudioMode) => void
  /** Last page visited in each mode, so switching modes returns where you were. Not persisted. */
  lastPathByMode: Record<StudioMode, string>
  rememberPath: (mode: StudioMode, path: string) => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  modelsOpen: boolean
  setModelsOpen: (open: boolean) => void
  /** Opened from "search a model": the dialog opens on this kind and focuses its Hugging Face search. */
  modelsSearchKind: StudioMode | null
  openModelSearch: (kind: StudioMode) => void
  clearModelSearch: () => void
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      mode: 'image',
      setMode: (mode) => set({ mode }),
      lastPathByMode: { ...DEFAULT_LAST_PATHS },
      rememberPath: (mode, path) => set((state) => ({ lastPathByMode: { ...state.lastPathByMode, [mode]: path } })),
      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      modelsOpen: false,
      setModelsOpen: (modelsOpen) => set({ modelsOpen }),
      modelsSearchKind: null,
      openModelSearch: (kind) => set({ modelsOpen: true, modelsSearchKind: kind }),
      clearModelSearch: () => set({ modelsSearchKind: null }),
    }),
    {
      name: 'cn-prefs', // same key as the former interface
      partialize: (state) => ({ sidebarOpen: state.sidebarOpen }),
    },
  ),
)
