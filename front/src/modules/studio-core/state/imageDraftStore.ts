/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { Asset, GenParams } from '../types'

/** An import in progress: a preview of the file is shown until the server answers. */
export interface PendingUpload {
  tempId: string
  previewUrl: string
  name: string
}

/** Size of an image, in pixels. */
export interface ImageSize {
  width: number
  height: number
}

/**
 * Draft of the image composer: what the user is preparing, shared by the home page, the conversation page and the
 * actions of the thread ("reuse this prompt", "use as reference", "reuse these settings"). The prompt, the parameters
 * of each model, the number of images and the last "Reference" size are kept across reloads (`cn-composer`); references,
 * imports and the seed are not.
 */
interface ImageDraftState {
  prompt: string
  references: Asset[]
  uploading: PendingUpload[]
  /** Parameters changed by the user, by model id (what is absent stays at the model's default). */
  paramsByModel: Record<string, GenParams>
  count: number
  /** Pinned seed; `null`: random at each generation. */
  seed: number | null
  /** Size of the last image generated with the "Reference" format, offered again once the references are gone. */
  referenceSize: ImageSize | null
  setPrompt: (prompt: string) => void
  addReferences: (assets: Asset[]) => void
  removeReference: (id: string) => void
  /** Moves a reference to `index` (0 = first: the image whose format and size "Reference" follows, image 1 for the model). */
  moveReference: (id: string, index: number) => void
  clearReferences: () => void
  setUploading: (uploading: PendingUpload[]) => void
  setParams: (modelId: string, patch: GenParams) => void
  resetParams: (modelId: string) => void
  setCount: (count: number) => void
  setSeed: (seed: number | null) => void
  setReferenceSize: (size: ImageSize) => void
}

export const useImageDraftStore = create<ImageDraftState>()(
  persist(
    (set) => ({
      prompt: '',
      references: [],
      uploading: [],
      paramsByModel: {},
      count: 1,
      seed: null,
      referenceSize: null,
      setPrompt: (prompt) => set({ prompt }),
      addReferences: (assets) =>
        set((state) => {
          const known = new Set(state.references.map((r) => r.id))
          return { references: [...state.references, ...assets.filter((a) => !known.has(a.id))] }
        }),
      removeReference: (id) => set((state) => ({ references: state.references.filter((r) => r.id !== id) })),
      moveReference: (id, index) =>
        set((state) => {
          const moved = state.references.find((r) => r.id === id)
          if (!moved) return {}
          const rest = state.references.filter((r) => r.id !== id)
          const at = Math.max(0, Math.min(rest.length, index))
          return { references: [...rest.slice(0, at), moved, ...rest.slice(at)] }
        }),
      clearReferences: () => set({ references: [] }),
      setUploading: (uploading) => set({ uploading }),
      setParams: (modelId, patch) => set((state) => ({ paramsByModel: { ...state.paramsByModel, [modelId]: { ...state.paramsByModel[modelId], ...patch } } })),
      resetParams: (modelId) =>
        set((state) => {
          const next = { ...state.paramsByModel }
          delete next[modelId]
          return { paramsByModel: next }
        }),
      setCount: (count) => set({ count }),
      setSeed: (seed) => set({ seed }),
      setReferenceSize: (referenceSize) => set({ referenceSize }),
    }),
    {
      name: 'cn-composer',
      storage: privacyStorage(),
      partialize: (state) => ({ prompt: state.prompt, paramsByModel: state.paramsByModel, count: state.count, referenceSize: state.referenceSize }),
    },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useImageDraftStore)
