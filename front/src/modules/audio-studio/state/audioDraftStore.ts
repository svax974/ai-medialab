/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { privacyStorage, registerPrivacyStore } from '@/modules/private/lib/privacyStorage'
import type { GenParams } from '@/modules/studio-core'
import type { VoiceRef } from '@/modules/voices'

/**
 * Draft of the audio composer, shared by the home page, the conversation page and the actions of the thread ("reuse text
 * and settings", "write with this voice"): the text, then per model the parameters, voice, language and style, the cast of a
 * dialogue, the number of takes, autoplay. Kept across reloads (`cn-audio-composer`) except the seed.
 */
interface AudioDraftState {
  prompt: string
  paramsByModel: Record<string, GenParams>
  voiceByModel: Record<string, VoiceRef | undefined>
  languageByModel: Record<string, string | undefined>
  instructByModel: Record<string, string | undefined>
  /** Voice of each character of a dialogue, by name. */
  cast: Record<string, VoiceRef | undefined>
  count: number
  autoplay: boolean
  /** Pinned seed; `null`: random at each generation. */
  seed: number | null
  setPrompt: (prompt: string) => void
  setParams: (modelId: string, patch: GenParams) => void
  resetParams: (modelId: string) => void
  setVoice: (modelId: string, voice: VoiceRef | undefined) => void
  setLanguage: (modelId: string, language: string) => void
  setInstruct: (modelId: string, instruct: string) => void
  setCast: (name: string, voice: VoiceRef | undefined) => void
  setCount: (count: number) => void
  setAutoplay: (autoplay: boolean) => void
  setSeed: (seed: number | null) => void
}

export const useAudioDraftStore = create<AudioDraftState>()(
  persist(
    (set) => ({
      prompt: '',
      paramsByModel: {},
      voiceByModel: {},
      languageByModel: {},
      instructByModel: {},
      cast: {},
      count: 1,
      autoplay: true,
      seed: null,
      setPrompt: (prompt) => set({ prompt }),
      setParams: (modelId, patch) => set((state) => ({ paramsByModel: { ...state.paramsByModel, [modelId]: { ...state.paramsByModel[modelId], ...patch } } })),
      resetParams: (modelId) =>
        set((state) => {
          const next = { ...state.paramsByModel }
          delete next[modelId]
          return { paramsByModel: next }
        }),
      setVoice: (modelId, voice) => set((state) => ({ voiceByModel: { ...state.voiceByModel, [modelId]: voice } })),
      setLanguage: (modelId, language) => set((state) => ({ languageByModel: { ...state.languageByModel, [modelId]: language } })),
      setInstruct: (modelId, instruct) => set((state) => ({ instructByModel: { ...state.instructByModel, [modelId]: instruct } })),
      setCast: (name, voice) => set((state) => ({ cast: { ...state.cast, [name]: voice } })),
      setCount: (count) => set({ count }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setSeed: (seed) => set({ seed }),
    }),
    {
      name: 'cn-audio-composer',
      storage: privacyStorage(),
      partialize: (state) => ({ prompt: state.prompt, paramsByModel: state.paramsByModel, voiceByModel: state.voiceByModel, languageByModel: state.languageByModel, instructByModel: state.instructByModel, cast: state.cast, count: state.count, autoplay: state.autoplay }),
    },
  ),
)

// Private generation: what the user typed is neither read nor written while it is on, and is emptied / read back around it.
registerPrivacyStore(useAudioDraftStore)
