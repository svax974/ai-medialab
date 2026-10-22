/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelKind } from '../types'

/** Model chosen by the user for each kind of creation (the composers of H4.3+ read it); `null`: the server default. */
interface ModelSelectionState {
  selected: Record<ModelKind, string | null>
  select: (kind: ModelKind, modelId: string) => void
}

export const useModelSelectionStore = create<ModelSelectionState>()(
  persist(
    (set) => ({
      selected: { image: null, audio: null, video: null, llm: null, diagram: null },
      select: (kind, modelId) => set((state) => ({ selected: { ...state.selected, [kind]: modelId } })),
    }),
    { name: 'cn-models' },
  ),
)
