/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Why a prompt could not be improved: the server's refusal code (`POST /api/chat/enhance-prompt`, 409), else the engine failing. */
export type EnhanceFailureCode = 'busy' | 'no_model' | 'no_engine' | 'upstream'

export interface EnhanceFailure {
  code: EnhanceFailureCode
  /** The server's own text: it adds the detail the help text does not have. */
  message: string
}

const CODES: readonly EnhanceFailureCode[] = ['busy', 'no_model', 'no_engine', 'upstream']

/** An error of the call as a failure with a help text of its own (anything unknown is the engine failing). */
export function enhanceFailure(error: unknown): EnhanceFailure {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  const known = CODES.find((c) => c === code)
  return { code: known ?? 'upstream', message: typeof message === 'string' ? message : '' }
}

/** Locale key of the help text of a failure. */
export const enhanceFailureKey = (code: EnhanceFailureCode): string => `chat.enhance.error.${code}`

/** What the button can do now: improve, or why it cannot (the tooltip says it). */
export type EnhanceState = 'ready' | 'empty' | 'no_model'

export function enhanceState(prompt: string, chatModelReady: boolean): EnhanceState {
  if (!chatModelReady) return 'no_model'
  return prompt.trim() ? 'ready' : 'empty'
}

/** The prompt before the improvement, kept to go back to it. */
export interface EnhanceUndo {
  original: string
  improved: string
}

/** Going back is offered while the prompt is still the improved one (once the user edits it, the improvement is theirs). */
export const canUndo = (prompt: string, undo: EnhanceUndo | null): boolean => undo !== null && prompt === undo.improved

/** Whether an improvement that arrives can replace the prompt: only if the user did not type something else meanwhile. */
export const canApply = (current: string, asked: string): boolean => current === asked
