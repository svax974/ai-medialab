/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ChatErrorCode } from '../types'

export type ChatErrorAction = 'install-engine' | 'choose-model' | 'raise-context' | 'retry'

export interface ChatErrorInfo {
  /** Locale key of the help text (the server's message is shown under it when it adds something). */
  key: string
  action: ChatErrorAction | null
}

const INFO: Record<ChatErrorCode, ChatErrorInfo> = {
  busy: { key: 'chat.error.busy', action: 'retry' },
  no_model: { key: 'chat.error.noModel', action: 'choose-model' },
  no_engine: { key: 'chat.error.noEngine', action: 'install-engine' },
  context_exceeded: { key: 'chat.error.contextExceeded', action: 'raise-context' },
  refused: { key: 'chat.error.refused', action: null },
  upstream: { key: 'chat.error.upstream', action: 'retry' },
  closed: { key: 'chat.error.closed', action: 'retry' },
  invalid: { key: 'chat.error.invalid', action: null },
}

/** What to tell the user for an error code of the answer stream, and the action that fixes it. */
export function chatErrorInfo(code: ChatErrorCode | string): ChatErrorInfo {
  return INFO[code as ChatErrorCode] ?? INFO.upstream
}

/** Error of a chat call: the stream's code, or the HTTP status of a refusal before the stream. */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly code: ChatErrorCode,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'ChatError'
  }
}

/**
 * The code a refusal before the stream maps to (409: busy or missing model; 404: missing conversation; others: invalid), when the
 * server did not name one. The message is in the language of the interface, so the patterns know both.
 */
export function codeOfStatus(status: number, message: string): ChatErrorCode {
  if (status === 409) return /moteur|engine|llama/i.test(message) ? 'no_engine' : /mod[eè]le|model/i.test(message) ? 'no_model' : 'busy'
  return status >= 500 || status === 0 ? 'upstream' : 'invalid'
}
