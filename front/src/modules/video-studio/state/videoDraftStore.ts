/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { Asset, GenParams } from '@/modules/studio-core/types'
import type { VideoSlot, VideoUpload } from '../types'

/**
 * Draft of the video composer, shared by the home page, the conversation page, the window drop and the actions of the thread
 * and of the viewer ("reuse settings", "use as source video", "last frame as start"): the prompt, the start image, the end
 * image and the source video, the imports in progress, per model the parameters, the number of clips and the seed. The prompt,
 * the parameters of each model and the number of clips are kept across reloads (`cn-video-composer`); the inputs, the
 * imports and the seed are not.
 */
interface VideoDraftState {
  prompt: string
  start: Asset | null
  end: Asset | null
  source: Asset | null
  uploads: VideoUpload[]
  /** Parameters changed by the user, by model id (what is absent stays at the model's default). */
  paramsByModel: Record<string, GenParams>
  count: number
  /** Pinned seed; `null`: random at each generation. */
  seed: number | null
  setPrompt: (prompt: string) => void
  setSlot: (slot: VideoSlot, asset: Asset | null) => void
  clearSlots: () => void
  updateUploads: (update: (uploads: VideoUpload[]) => VideoUpload[]) => void
  setParams: (modelId: string, patch: GenParams) => void
  resetParams: (modelId: string) => void
  setCount: (count: number) => void
  setSeed: (seed: number | null) => void
}

const SLOT_FIELD = { start: 'start', end: 'end', source: 'source' } as const

export const useVideoDraftStore = create<VideoDraftState>()(
  persist(
    (set) => ({
      prompt: '',
      start: null,
      end: null,
      source: null,
      uploads: [],
      paramsByModel: {},
      count: 1,
      seed: null,
      setPrompt: (prompt) => set({ prompt }),
      setSlot: (slot, asset) => set({ [SLOT_FIELD[slot]]: asset }),
      clearSlots: () => set({ start: null, end: null, source: null }),
      updateUploads: (update) => set((state) => ({ uploads: update(state.uploads) })),
      setParams: (modelId, patch) => set((state) => ({ paramsByModel: { ...state.paramsByModel, [modelId]: { ...state.paramsByModel[modelId], ...patch } } })),
      resetParams: (modelId) =>
        set((state) => {
          const next = { ...state.paramsByModel }
          delete next[modelId]
          return { paramsByModel: next }
        }),
      setCount: (count) => set({ count }),
      setSeed: (seed) => set({ seed }),
    }),
    {
      name: 'cn-video-composer',
      storage: privacyStorage(),
      partialize: (state) => ({ prompt: state.prompt, paramsByModel: state.paramsByModel, count: state.count }),
    },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useVideoDraftStore)
