/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { LocalAiState } from './localAi'

export interface LaunchPromptInput {
  state: LocalAiState
  /** llama.cpp is installed (a chat model alone being missing is not worth a popup: the Chat page and the model list offer it). */
  engineInstalled: boolean
  optOut: boolean
  dismissed: boolean
  /** A private generation session is on: nothing is proposed in the middle of it. */
  privateMode: boolean
}

/** Whether the launch invitation is due: the chat engine is missing, nothing is under way, and it was neither dismissed nor switched off. */
export function shouldPromptLocalAi({ state, engineInstalled, optOut, dismissed, privateMode }: LaunchPromptInput): boolean {
  if (optOut || dismissed || privateMode || engineInstalled) return false
  return state === 'needs-setup' || state === 'no-space'
}
