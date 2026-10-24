/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readSse, SseParser } from '@/modules_shared/common/core/events'
import { languageHeaders } from '@/modules/studio-shell/lib/languageHeaders'
import { studioApiBase, studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import { isPrivateMode } from '@/modules/private/state/privateStore'
import type { ConversationDetail } from '@/modules/studio-core/types'
import { ChatError, codeOfStatus } from '../lib/errors'
import { toChatEvent } from '../lib/sse'
import { privateChats } from '@/modules/private/lib/privateChatMemory'
import { privateChatApi, streamPrivateAnswer } from './privateChatBackend'
import type { ChatAttachment, ChatConversation, ChatErrorCode, ChatGeneration, ChatMessage, ChatSearchHit, ChatSettings, ChatSettingsPatch, ChatStreamEvent, SendBody } from '../types'

const enc = encodeURIComponent
const base = (id: string) => `/chat/conversations/${enc(id)}`

export type ExportFormat = 'md' | 'json'

/** The longest search the server accepts (400 beyond). */
const MAX_QUERY_CHARS = 200

/**
 * Nest routes `/api/chat/*` (`back/src/modules/chat/README.md`) and the shared conversation routes for the chat mode. In a
 * private session the conversation is the browser's (`privateChatBackend.ts`): what it holds is read from memory, and the
 * routes that carry content (the uploads, the prompt improvement) go to their private twin (`private/lib/privateRouting.ts`).
 */
export const chatApi = {
  /** A new, empty conversation of the chat mode (the title is chosen by the server, then by the first answer). */
  createConversation(): Promise<ConversationDetail> {
    return studioRequest<ConversationDetail>('post', '/conversations', { mode: 'chat' })
  },
  get(id: string): Promise<ChatConversation> {
    if (isPrivateMode()) return privateChatApi.get(id)
    return studioRequest<ChatConversation>('get', base(id))
  },
  patchSettings(id: string, patch: ChatSettingsPatch): Promise<ChatSettings> {
    if (isPrivateMode()) return privateChatApi.patchSettings(id, patch)
    return studioRequest<ChatSettings>('patch', `${base(id)}/settings`, patch)
  },
  setLeaf(id: string, messageId: string): Promise<ChatConversation> {
    if (isPrivateMode()) return privateChatApi.setLeaf(id, messageId)
    return studioRequest<ChatConversation>('post', `${base(id)}/leaf`, { message_id: messageId })
  },
  removeMessage(id: string, messageId: string): Promise<ChatConversation> {
    if (isPrivateMode()) return privateChatApi.removeMessage(id, messageId)
    return studioRequest<ChatConversation>('delete', `${base(id)}/messages/${enc(messageId)}`)
  },
  /** The complete siblings of a message (a comparison of answers), oldest first, whichever branch is active. */
  siblings(id: string, messageId: string): Promise<ChatMessage[]> {
    if (isPrivateMode()) return privateChatApi.siblings(id, messageId)
    return studioRequest<ChatMessage[]>('get', `${base(id)}/messages/${enc(messageId)}/siblings`)
  },
  /** Starts a generation of an answer that waited for a choice: the duration of a video, or the voice of an audio. */
  confirmGeneration(messageId: string, generationId: string, choice: { seconds: number } | { voice_id: string }): Promise<ChatGeneration> {
    return studioRequest<ChatGeneration>('post', `/chat/messages/${enc(messageId)}/generations/${enc(generationId)}/confirm`, choice)
  },
  /** Unloads the chat model from memory (409 `busy` while an answer is being written). */
  unloadModel(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('post', '/chat/model/unload')
  },
  search(query: string): Promise<ChatSearchHit[]> {
    if (isPrivateMode()) return privateChatApi.search(query)
    return studioRequest<ChatSearchHit[]>('get', `/chat/search?q=${enc(query.trim().slice(0, MAX_QUERY_CHARS))}`)
  },
  async upload(file: File, onProgress?: (percent: number | null) => void): Promise<ChatAttachment> {
    const form = new FormData()
    form.append('file', file)
    const attachment = await studioUpload<ChatAttachment>('/chat/attachments', form, { onProgress })
    if (isPrivateMode()) privateChats.rememberUpload(attachment) // the history names a text file by what the user picked
    return attachment
  },
  /** URL of the export of a conversation (a download: the browser follows it). */
  exportUrl(id: string, format: ExportFormat): string {
    return `${studioApiBase()}${base(id)}/export?format=${format}`
  },
  /** What to download for an export: the server's URL, or in a private session a file made from the conversation in memory (`name` is then the file name). */
  async exportFile(id: string, format: ExportFormat): Promise<{ href: string; name: string }> {
    return isPrivateMode() ? privateChatApi.exportFile(id, format) : { href: this.exportUrl(id, format), name: '' }
  },
  enhancePrompt(kind: 'image' | 'audio' | 'video', prompt: string, modelId?: string): Promise<{ prompt: string; model_id: string }> {
    return studioRequest('post', '/chat/enhance-prompt', { kind, prompt, ...(modelId ? { model_id: modelId } : {}) })
  },
}

/** Path of each way to ask for an answer (the three answer routes of the contract; in a private session they only name the answer). */
export const answerPaths = {
  send: (id: string) => `${base(id)}/messages`,
  regenerate: (id: string, messageId: string) => `${base(id)}/messages/${enc(messageId)}/regenerate`,
  edit: (id: string, messageId: string) => `${base(id)}/messages/${enc(messageId)}/edit`,
}

export type AnswerBody = SendBody | { model_id?: string; force_memory?: boolean } | { content: string; attachments?: { name: string }[] }

const CODES: readonly ChatErrorCode[] = ['busy', 'no_model', 'no_engine', 'context_exceeded', 'refused', 'upstream', 'closed', 'invalid', 'memory']

async function refusal(response: Response): Promise<ChatError> {
  let message = `HTTP ${response.status}`
  let code: ChatErrorCode | null = null
  try {
    const payload = (await response.json()) as { message?: string | string[]; code?: string }
    if (payload.message) message = Array.isArray(payload.message) ? payload.message.join(' ') : payload.message
    code = CODES.find((known) => known === payload.code) ?? null
  } catch {
    // not JSON: keep the status
  }
  return new ChatError(message, code ?? codeOfStatus(response.status, message), response.status)
}

/**
 * Asks for an answer and reads its server-sent events as they arrive (`fetch` + a stream: `EventSource` cannot POST). Each
 * event goes to `onEvent`; a refusal before the stream throws a `ChatError`; a stream that stops without a `done` or an
 * `error` event ends with a synthetic `error` (`closed`). Aborting `signal` stops quietly (the server cancels the answer).
 */
export async function streamAnswer(path: string, body: AnswerBody, options: { signal: AbortSignal; onEvent: (event: ChatStreamEvent) => void }): Promise<void> {
  const { signal, onEvent } = options
  // Private generation: the conversation is the browser's and the answer comes from the stateless private route.
  if (isPrivateMode()) return streamPrivateAnswer(path, body, options)
  let response: Response
  try {
    response = await fetch(studioApiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...languageHeaders() },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) return
    throw new ChatError((error as Error).message, 'upstream')
  }
  if (!response.ok) throw await refusal(response)
  if (!response.body) throw new ChatError('', 'upstream')
  let finished = false
  try {
    await readSse(response.body, new SseParser(), (block) => {
      const event = toChatEvent(block)
      if (!event) return
      if (event.type === 'done' || event.type === 'error') finished = true
      onEvent(event)
    })
  } catch (error) {
    if (signal.aborted) return
    throw new ChatError((error as Error).message, 'closed')
  }
  if (!finished && !signal.aborted) onEvent({ type: 'error', code: 'closed', message: '' })
}
