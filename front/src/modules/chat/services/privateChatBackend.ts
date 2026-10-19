/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readSse, SseParser } from '@/modules_shared/common/core/events'
import { privateChats, registerPrivateCleanup, trackPrivateStream, type PrivateChat } from '@/modules/private/lib/privateChatMemory'
import { languageHeaders } from '@/modules/studio-shell/lib/languageHeaders'
import { StudioApiError, studioApiBase, studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { ConversationSummary } from '@/modules/studio-shell/types'
import { ChatError, codeOfStatus } from '../lib/errors'
import { mergeSettings } from '../lib/settingsMerge'
import {
  activeBranch, branchTo, historyTo, leafAfterRemoval, newestLeafBelow, nextCreatedAt, siblingsOf, subtreeIds, toMarkdown, withSiblings,
} from '../lib/privateTree'
import { BASE_SETTINGS } from '../state/chatDefaultsStore'
import type {
  ChatAttachment, ChatConversation, ChatErrorCode, ChatMessage, ChatSearchHit, ChatSettings, ChatSettingsPatch, ChatStats, ChatStreamEvent, SendBody, ToolRun,
} from '../types'

/**
 * The chat of a private session. The conversation (settings and tree of messages) is held HERE, in this page's memory,
 * and nowhere else: not in `localStorage`, not in the cache of a persistent route, not on the server, which only gets
 * the history with each request (`POST /api/private/chat`, `back/src/modules/private/README.md`) and answers with the
 * events of the normal chat. What this file answers to the interface has the shapes of the persistent chat, so the
 * thread, the composer and the answer runner do not know the difference: `chatApi` and `streamAnswer` send here while
 * the private mode is on. The server keeps one thing: a shell of the conversation (a generic title, a message count)
 * for the sidebar's list.
 */

const enc = encodeURIComponent
const MAX_SNIPPET = 160
const SEARCH_LIMIT = 50

export type PrivateAnswerBody = SendBody | { model_id?: string } | { content: string; attachments?: { name: string }[] }

/** What `streamAnswer` is asked: the path of the persistent route it replaces says which of the three answers it is. */
export interface AnswerTarget {
  conversationId: string
  kind: 'send' | 'regenerate' | 'edit'
  messageId?: string
}

const ANSWER_PATH = /^\/chat\/conversations\/([^/]+)\/messages(?:\/([^/]+)\/(regenerate|edit))?$/

export function parseAnswerPath(path: string): AnswerTarget | null {
  const match = ANSWER_PATH.exec(path)
  if (!match) return null
  return { conversationId: decodeURIComponent(match[1]), kind: (match[3] as 'regenerate' | 'edit' | undefined) ?? 'send', messageId: match[2] ? decodeURIComponent(match[2]) : undefined }
}

const newId = (): string => globalThis.crypto.randomUUID()

/** The conversation, created empty the first time it is touched (the home page makes its shell, then sets its settings). */
function chatOf(id: string): PrivateChat {
  return privateChats.get(id) ?? privateChats.set(id, { settings: { ...BASE_SETTINGS }, messages: new Map() })
}

const missing = (): StudioApiError => new StudioApiError('Conversation introuvable.', 404)
const busy = (): StudioApiError => new StudioApiError('Une réponse est en cours : attendez sa fin.', 409, 'busy')

/** The conversation as the interface reads it: the shell the server keeps (title, pin), the settings, the active branch. */
async function view(id: string): Promise<ChatConversation> {
  const chat = chatOf(id)
  const { messages: _empty, ...shell } = await studioRequest<ConversationSummary & { messages: unknown[] }>('get', `/conversations/${enc(id)}`)
  void _empty
  return { conversation: shell, settings: { ...chat.settings }, messages: activeBranch(chat.messages, chat.settings.leaf_id) }
}

/** Tells the shell how many messages the conversation holds (a number: the list shows it); a failure changes nothing. */
function syncCount(id: string): void {
  const chat = privateChats.get(id)
  if (!chat) return
  void studioRequest('patch', `/conversations/${enc(id)}`, { message_count: branchTo(chat.messages, chat.settings.leaf_id).length }).catch(() => undefined)
}

function excerpt(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query)
  const from = Math.max(0, at - 40)
  return `${from > 0 ? '…' : ''}${text.slice(from, from + MAX_SNIPPET).replace(/\s+/g, ' ')}`
}

const exportLinks = new Set<string>()
registerPrivateCleanup(() => {
  exportLinks.forEach((url) => URL.revokeObjectURL(url))
  exportLinks.clear()
})

/** Everything of the persistent `chatApi` that the private conversation answers itself (the rest goes through the private routes). */
export const privateChatApi = {
  get: (id: string): Promise<ChatConversation> => view(id),

  async patchSettings(id: string, patch: ChatSettingsPatch): Promise<ChatSettings> {
    const chat = chatOf(id)
    chat.settings = mergeSettings(chat.settings, patch)
    return { ...chat.settings }
  },

  async setLeaf(id: string, messageId: string): Promise<ChatConversation> {
    const chat = chatOf(id)
    if (!chat.messages.has(messageId)) throw missing()
    chat.settings = { ...chat.settings, leaf_id: newestLeafBelow(chat.messages, messageId) }
    syncCount(id)
    return view(id)
  },

  async removeMessage(id: string, messageId: string): Promise<ChatConversation> {
    const chat = chatOf(id)
    const removed = chat.messages.get(messageId)
    if (!removed) throw missing()
    if ([...chat.messages.values()].some((m) => m.status === 'streaming')) throw busy()
    const onBranch = branchTo(chat.messages, chat.settings.leaf_id).some((m) => m.id === messageId)
    const leaf = onBranch ? leafAfterRemoval(chat.messages, removed) : chat.settings.leaf_id
    for (const gone of subtreeIds(chat.messages, messageId)) chat.messages.delete(gone)
    chat.settings = { ...chat.settings, leaf_id: leaf }
    syncCount(id)
    return view(id)
  },

  async siblings(id: string, messageId: string): Promise<ChatMessage[]> {
    const chat = chatOf(id)
    const message = chat.messages.get(messageId)
    if (!message) throw missing()
    return siblingsOf(chat.messages, message).map((m) => withSiblings(chat.messages, m))
  },

  /** Text search in the conversations of this session (they exist only here). */
  async search(query: string): Promise<ChatSearchHit[]> {
    const q = query.trim().toLowerCase()
    const hits: ChatSearchHit[] = []
    for (const [conversationId, chat] of privateChats.all()) {
      for (const m of chat.messages.values()) {
        if (hits.length < SEARCH_LIMIT && q && m.content.toLowerCase().includes(q)) hits.push({ conversation_id: conversationId, message_id: m.id, snippet: excerpt(m.content, q) })
      }
    }
    return hits
  },

  /** The export of the active branch: a file made here (a link to a blob of this page), never a download from the server. */
  async exportFile(id: string, format: 'md' | 'json'): Promise<{ href: string; name: string }> {
    const chat = chatOf(id)
    const { conversation } = await view(id)
    const branch = activeBranch(chat.messages, chat.settings.leaf_id)
    const body = format === 'md'
      ? toMarkdown(conversation.title, branch, (m) => m.model_id ?? 'Modèle')
      : JSON.stringify({ title: conversation.title, settings: chat.settings, messages: branch }, null, 2)
    const url = URL.createObjectURL(new Blob([body], { type: format === 'md' ? 'text/markdown' : 'application/json' }))
    exportLinks.add(url)
    return { href: url, name: `${conversation.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'conversation'}.${format}` }
  },
}

// An answer ------------------------------------------------------------------------------------------------------------

interface Turn {
  /** The user message this answer is for (new, or the one a regeneration answers). */
  user: ChatMessage
  /** Whether it is created by this request (a send, an edit) rather than already in the tree. */
  userIsNew: boolean
  assistant: ChatMessage
}

function blank(chat: PrivateChat, conversationId: string, fields: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return {
    id: newId(), conversation_id: conversationId, parent_id: null, content: '', reasoning: null, tool_runs: [], generations: [], attachments: [], model_id: null, params: null,
    status: 'done', error: null, stats: null, created_at: nextCreatedAt(chat.messages), sibling_ids: [], sibling_index: 0, ...fields,
  }
}

/** The files named by a send or an edit, as uploaded in this session (an unknown name is refused, like the server does). */
function attached(names: { name: string }[] | undefined): ChatAttachment[] {
  return (names ?? []).map(({ name }) => privateChats.upload(name) ?? (() => { throw new ChatError(`Pièce jointe introuvable : ${name}.`, 'invalid') })())
}

/** What the request asks for, checked against the tree, before anything is created or sent. */
function plan(chat: PrivateChat, target: AnswerTarget, body: PrivateAnswerBody): Turn {
  const { messages, settings } = chat
  const model = ('model_id' in body ? body.model_id : undefined) ?? settings.model_id
  const answer = { role: 'assistant' as const, status: 'streaming' as const, model_id: model, params: { ...settings.params, reasoning: settings.reasoning } }
  if (target.kind === 'regenerate') {
    const old = messages.get(target.messageId ?? '')
    const user = old?.parent_id ? messages.get(old.parent_id) : undefined
    if (!old || old.role !== 'assistant' || !user) throw new ChatError('Seule une réponse du modèle peut être régénérée.', 'invalid')
    return { user, userIsNew: false, assistant: blank(chat, target.conversationId, { ...answer, parent_id: user.id }) }
  }
  const content = (body as { content?: string }).content ?? ''
  let parent: string | null
  let files: ChatAttachment[]
  if (target.kind === 'edit') {
    const original = messages.get(target.messageId ?? '')
    if (!original || original.role !== 'user') throw new ChatError('Seul un message utilisateur peut être modifié.', 'invalid')
    const named = (body as { attachments?: { name: string }[] }).attachments
    parent = original.parent_id
    files = named ? attached(named) : original.attachments
  } else {
    const wanted = (body as SendBody).parent_id
    parent = wanted === undefined ? settings.leaf_id : wanted
    if (parent && messages.get(parent)?.role !== 'assistant') throw new ChatError('parent_id : une réponse du modèle est attendue.', 'invalid')
    files = attached((body as SendBody).attachments)
  }
  const user = blank(chat, target.conversationId, { role: 'user', parent_id: parent, content, attachments: files })
  return { user, userIsNew: true, assistant: blank(chat, target.conversationId, { ...answer, parent_id: user.id, created_at: user.created_at + 0.001 }) }
}

/** The settings the server needs: the model and the sampling, without what is unset. */
function serverSettings(settings: ChatSettings, model: string | null): Record<string, unknown> {
  const { seed, ...params } = settings.params
  return {
    ...(model ? { model_id: model } : {}), system_prompt: settings.system_prompt, params: { ...params, ...(seed == null ? {} : { seed }) },
    context_size: settings.context_size, reasoning: settings.reasoning, tools: settings.tools,
  }
}

async function refusal(response: Response): Promise<ChatError> {
  let message = `HTTP ${response.status}`
  let code: ChatErrorCode | null = null
  try {
    const payload = (await response.json()) as { message?: string | string[]; code?: ChatErrorCode }
    if (payload.message) message = Array.isArray(payload.message) ? payload.message.join(' ') : payload.message
    code = payload.code ?? null
  } catch {
    // not JSON: keep the status
  }
  return new ChatError(message, code ?? codeOfStatus(response.status, message), response.status)
}

type Emit = (event: ChatStreamEvent) => void

function put(chat: PrivateChat, message: ChatMessage): ChatMessage {
  chat.messages.set(message.id, message)
  return message
}

function view1(chat: PrivateChat, message: ChatMessage): ChatMessage {
  return withSiblings(chat.messages, message)
}

/** Adds the messages of a turn to the conversation and tells the interface, as the server does at the start of a reply. */
function open(chat: PrivateChat, turn: Turn, emit: Emit): void {
  if (turn.userIsNew) {
    put(chat, turn.user)
    emit({ type: 'message', message: view1(chat, turn.user) })
  }
  put(chat, turn.assistant)
  chat.settings = { ...chat.settings, leaf_id: turn.assistant.id }
  emit({ type: 'message', message: view1(chat, turn.assistant) })
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** Applies one event of the server's stream to the answer in the tree and to the interface (the answer keeps what it received). */
function apply(chat: PrivateChat, id: string, name: string, raw: Record<string, unknown>, emit: Emit): 'done' | 'error' | null {
  const current = chat.messages.get(id)
  if (!current) return null
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  const update = (fields: Partial<ChatMessage>) => put(chat, { ...current, ...fields })
  switch (name) {
    case 'loading':
      emit({ type: 'loading', phase: (text('phase') || 'loading') as 'starting' | 'loading' | 'ready', model_id: text('model_id'), elapsed_s: typeof raw.elapsed_s === 'number' ? raw.elapsed_s : undefined })
      return null
    case 'delta':
      update({ content: current.content + text('content') })
      emit({ type: 'delta', id, content: text('content') })
      return null
    case 'reasoning':
      update({ reasoning: (current.reasoning ?? '') + text('content') })
      emit({ type: 'reasoning', id, content: text('content') })
      return null
    case 'tool': {
      const run = raw.run as ToolRun
      const runs = current.tool_runs.some((r) => r.id === run.id) ? current.tool_runs.map((r) => (r.id === run.id ? run : r)) : [...current.tool_runs, run]
      update({ tool_runs: runs })
      emit({ type: 'tool', id, run })
      return null
    }
    case 'usage':
      update({ stats: raw.stats as ChatStats })
      emit({ type: 'usage', id, stats: raw.stats as ChatStats })
      return null
    case 'done': {
      const done = update({ status: 'done', error: null, stats: (raw.stats as ChatStats) ?? current.stats, tool_runs: (raw.tool_runs as ToolRun[]) ?? current.tool_runs })
      emit({ type: 'done', message: view1(chat, done) })
      return 'done'
    }
    default: {
      update({ status: 'error', error: text('message') })
      emit({ type: 'error', code: (text('code') || 'upstream') as ChatErrorCode, message: text('message'), id })
      return 'error'
    }
  }
}

function parseBlock(block: { event: string; data: string }): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(block.data))
  } catch {
    return null
  }
}

/**
 * Asks for an answer in a private chat and reads its events, as `streamAnswer` does for the persistent chat. The tree is
 * written as the answer comes (the interface gets the same events); a refusal before the answer starts creates nothing.
 * Aborting leaves the text received with the status `cancelled`, as the server does for the persistent chat.
 */
export async function streamPrivateAnswer(path: string, body: PrivateAnswerBody, options: { signal: AbortSignal; onEvent: Emit }): Promise<void> {
  const target = parseAnswerPath(path)
  if (!target) throw new ChatError('Route de chat inconnue.', 'invalid')
  const chat = chatOf(target.conversationId)
  const turn = plan(chat, target, body)
  const local = new AbortController()
  const stopTracking = trackPrivateStream(local)
  const relay = () => local.abort()
  options.signal.addEventListener('abort', relay, { once: true })
  if (options.signal.aborted) local.abort()
  try {
    await read(chat, turn, local.signal, options.onEvent)
  } finally {
    options.signal.removeEventListener('abort', relay)
    stopTracking()
    const mine = privateChats.get(target.conversationId) === chat
    const last = chat.messages.get(turn.assistant.id)
    if (mine && last?.status === 'streaming') chat.messages.set(last.id, { ...last, status: 'cancelled' })
    if (mine) syncCount(target.conversationId)
  }
}

async function read(chat: PrivateChat, turn: Turn, signal: AbortSignal, emit: Emit): Promise<void> {
  const model = turn.assistant.model_id
  const payload = {
    reply_id: turn.assistant.id,
    messages: historyTo(new Map([...chat.messages, ...(turn.userIsNew ? [[turn.user.id, turn.user] as const] : [])]), turn.user.id),
    settings: serverSettings(chat.settings, model),
  }
  let response: Response
  try {
    response = await fetch(`${studioApiBase()}/private/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...languageHeaders() }, body: JSON.stringify(payload), signal,
    })
  } catch (error) {
    if (signal.aborted) return
    throw new ChatError((error as Error).message, 'upstream')
  }
  if (!response.ok) throw await refusal(response)
  if (!response.body) throw new ChatError('', 'upstream')
  let accepted = false
  let finished = false
  try {
    await readSse(response.body, new SseParser(), (block) => {
      const data = parseBlock(block)
      if (!data || finished) return
      if (!accepted) {
        if (block.event === 'accepted') {
          open(chat, turn, emit)
          accepted = true
        } else if (block.event === 'error') {
          finished = true // a refusal before the answer starts: nothing was created
          emit({ type: 'error', code: (data.code as ChatErrorCode) ?? 'upstream', message: String(data.message ?? '') })
        }
        return
      }
      finished = apply(chat, turn.assistant.id, block.event, data, emit) !== null
    })
  } catch (error) {
    if (signal.aborted) return
    throw new ChatError((error as Error).message, 'closed')
  }
  if (!finished && !signal.aborted) {
    if (accepted) apply(chat, turn.assistant.id, 'error', { code: 'closed', message: '' }, emit)
    else emit({ type: 'error', code: 'closed', message: '' })
  }
}
