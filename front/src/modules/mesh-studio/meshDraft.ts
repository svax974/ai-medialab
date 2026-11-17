/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */
import { create } from 'zustand'
import type { Asset } from '@/modules/media-library/types'
import type { GenParams } from '@/modules/studio-core'
import { registerPrivateCleanup } from '@/modules/private/lib/privateChatMemory'

interface Draft { prompt: string; reference: Asset | null; params: Record<string, GenParams>; seed: number | null; set: (patch: Partial<Omit<Draft, 'set'>>) => void }
export const useMeshDraft = create<Draft>((set) => ({ prompt: '', reference: null, params: {}, seed: null, set }))
registerPrivateCleanup(() => useMeshDraft.getState().set({ prompt: '', reference: null, params: {}, seed: null }))
