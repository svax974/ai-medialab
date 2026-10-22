/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { DiagramTheme, DiagramType } from '../types'

/**
 * Draft of the diagram composer: the prompt, the diagram type and the visual theme, kept across reloads
 * (`cn-diagram-composer`) like the other composers' drafts. No references, no generation params: a diagram is prompt
 * + type + theme only.
 */
interface DiagramDraftState {
  prompt: string
  diagramType: DiagramType
  theme: DiagramTheme
  setPrompt: (prompt: string) => void
  setDiagramType: (diagramType: DiagramType) => void
  setTheme: (theme: DiagramTheme) => void
}

export const useDiagramDraftStore = create<DiagramDraftState>()(
  persist(
    (set) => ({
      prompt: '',
      diagramType: 'flowchart',
      theme: 'light',
      setPrompt: (prompt) => set({ prompt }),
      setDiagramType: (diagramType) => set({ diagramType }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'cn-diagram-composer',
      storage: privacyStorage(),
      partialize: (state) => ({ diagramType: state.diagramType, theme: state.theme }),
    },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useDiagramDraftStore)
