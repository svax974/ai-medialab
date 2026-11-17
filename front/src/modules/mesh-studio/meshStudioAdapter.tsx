/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */
import type { ModeAdapter } from '@/modules/studio-core'
import { MeshAssistant } from './MeshAssistant'
import { Composer } from './meshStudio'
import { useMeshDraft } from './meshDraft'

export const meshStudioAdapter: ModeAdapter = {
  kind: 'mesh', Composer, AssistantMessage: MeshAssistant,
  reuseUserMessage: (message) => useMeshDraft.getState().set({ prompt: message.prompt, reference: message.references[0] ?? null }),
}
