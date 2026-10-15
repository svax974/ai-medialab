/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async (_method: string, path: string): Promise<unknown> => (path.startsWith('/conversations/') ? { id: 'c1', title: 'Conversation privée', mode: 'chat', messages: [] } : {})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({
  studioRequest,
  studioApiBase: () => '/api',
  StudioApiError: class StudioApiError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
      super(message)
    }
  },
}))

import { forgetPrivateChats, privateChats } from '@/modules/private/lib/privateChatMemory'
import { ChatError } from '../lib/errors'
import type { ChatAttachment, ChatMessage, ChatStreamEvent } from '../types'
import { parseAnswerPath, privateChatApi, streamPrivateAnswer } from './privateChatBackend'

const SENTINEL = 'SENTINELLE-chat-privé-91c3'
const block = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const sse = (...blocks: string[]) => new Response(new Blob([blocks.join('')]).stream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

/** What the private route answers for a reply: accepted, the text in two pieces, the usage and the end. */
const reply = (id: string, ...texts: string[]) => [
  block('accepted', { id }),
  block('loading', { phase: 'loading', model_id: 'llm-a', elapsed_s: 1 }),
  block('reasoning', { id, content: 'Je réfléchis.' }),
  ...texts.map((content) => block('delta', { id, content })),
  block('usage', { id, stats: { prompt_tokens: 5, completion_tokens: 2, tokens_per_second: 40, context_size: 16384, elapsed_ms: 10 } }),
  block('done', { id, stats: { prompt_tokens: 5, completion_tokens: 2, tokens_per_second: 40, context_size: 16384, elapsed_ms: 12 }, tool_runs: [] }),
]

const fetchMock = vi.fn()
/** The next call of the private route answers with these blocks, whatever the reply id (the first block carries it). */
const answer = (make: (id: string) => string[]) =>
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    const { reply_id: id } = JSON.parse(init.body as string) as { reply_id: string }
    return sse(...make(id))
  })

async function run(path: string, body: object, signal = new AbortController().signal): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  await streamPrivateAnswer(path, body, { signal, onEvent: (e) => events.push(e) })
  return events
}

const send = (content: string, extra: object = {}) => run('/chat/conversations/c1/messages', { content, model_id: 'llm-a', ...extra })
const sent = (call = 0) => JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as { reply_id: string; messages: { role: string; content: string; attachments: unknown[] }[]; settings: Record<string, unknown> }
const branch = async () => (await privateChatApi.get('c1')).messages

const upload = (name: string, kind: 'image' | 'text' = 'text'): ChatAttachment => ({ kind, name, original_name: kind === 'text' ? 'notes.md' : 'photo.png', mime: kind === 'text' ? 'text/plain' : 'image/png', size: 3 })

describe('the private chat backend', () => {
  beforeEach(() => {
    forgetPrivateChats()
    studioRequest.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('knows which of the three answers a path asks for', () => {
    expect(parseAnswerPath('/chat/conversations/c1/messages')).toEqual({ conversationId: 'c1', kind: 'send', messageId: undefined })
    expect(parseAnswerPath('/chat/conversations/c%201/messages/m1/regenerate')).toEqual({ conversationId: 'c 1', kind: 'regenerate', messageId: 'm1' })
    expect(parseAnswerPath('/chat/conversations/c1/messages/m1/edit')).toMatchObject({ kind: 'edit', messageId: 'm1' })
    expect(parseAnswerPath('/chat/search')).toBeNull()
  })

  it('creates the conversation empty on first use, with the shell the server keeps', async () => {
    const conversation = await privateChatApi.get('c1')
    expect(conversation.messages).toEqual([])
    expect(conversation.settings).toMatchObject({ model_id: null, system_prompt: '', reasoning: 'auto', tools: { web: false }, leaf_id: null })
    expect(conversation.conversation).toMatchObject({ id: 'c1', title: 'Conversation privée' })
    expect(studioRequest).toHaveBeenCalledWith('get', '/conversations/c1')
  })

  describe('an answer', () => {
    it('adds the user message and the answer, streams the same events as the persistent chat and keeps the final text', async () => {
      answer((id) => reply(id, 'Bon', 'jour'))
      await privateChatApi.patchSettings('c1', { system_prompt: 'Sois bref.', params: { temperature: 0.3 }, model_id: 'llm-a' })
      const events = await send('Bonjour')
      expect(events.map((e) => e.type)).toEqual(['message', 'message', 'loading', 'reasoning', 'delta', 'delta', 'usage', 'done'])
      const [user, assistant] = events.slice(0, 2).map((e) => (e as { message: ChatMessage }).message)
      expect(user).toMatchObject({ role: 'user', content: 'Bonjour', parent_id: null, status: 'done', sibling_ids: [user.id] })
      expect(assistant).toMatchObject({ role: 'assistant', content: '', parent_id: user.id, status: 'streaming', model_id: 'llm-a' })
      expect(events.filter((e) => e.type === 'delta')).toEqual([{ type: 'delta', id: assistant.id, content: 'Bon' }, { type: 'delta', id: assistant.id, content: 'jour' }])
      const final = (events.at(-1) as { message: ChatMessage }).message
      expect(final).toMatchObject({ id: assistant.id, status: 'done', content: 'Bonjour', reasoning: 'Je réfléchis.', error: null, stats: { completion_tokens: 2 } })
      expect((await branch()).map((m) => [m.role, m.content])).toEqual([['user', 'Bonjour'], ['assistant', 'Bonjour']])
      expect((await privateChatApi.get('c1')).settings.leaf_id).toBe(assistant.id)
      expect(studioRequest).toHaveBeenCalledWith('patch', '/conversations/c1', { message_count: 2 })
      // what the server got: the history, the id the events will carry, the settings
      expect(sent()).toMatchObject({ reply_id: assistant.id, messages: [{ role: 'user', content: 'Bonjour', attachments: [] }], settings: { model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.3 }, reasoning: 'auto', tools: { web: false } } })
      expect(fetchMock.mock.calls[0][0]).toBe('/api/private/chat')
    })

    it('sends the whole branch with the next question, files by stored and picked name', async () => {
      answer((id) => reply(id, 'Bon'))
      await send('Q1')
      privateChats.rememberUpload(upload('chat_0123456789abcdef.md'))
      answer((id) => reply(id, 'Re'))
      await send('Q2', { attachments: [{ name: 'chat_0123456789abcdef.md' }] })
      expect(sent(1).messages).toEqual([
        { role: 'user', content: 'Q1', attachments: [] }, { role: 'assistant', content: 'Bon', attachments: [] },
        { role: 'user', content: 'Q2', attachments: [{ name: 'chat_0123456789abcdef.md', original_name: 'notes.md' }] },
      ])
      expect((await branch()).at(-2)?.attachments).toEqual([upload('chat_0123456789abcdef.md')])
    })

    it('refuses a file that is not in this session before sending anything', async () => {
      await expect(send('Q', { attachments: [{ name: 'chat_aaaaaaaaaaaaaaaa.png' }] })).rejects.toMatchObject({ code: 'invalid' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(await branch()).toEqual([])
    })

    it('regenerates as a sibling answer (another model: the comparison) and edits as a sibling question', async () => {
      answer((id) => reply(id, 'Un'))
      await send('Q1')
      const [user, first] = await branch()
      answer((id) => reply(id, 'Deux'))
      await run(`/chat/conversations/c1/messages/${first.id}/regenerate`, { model_id: 'llm-b' })
      const regenerated = await branch()
      expect(regenerated.map((m) => m.content)).toEqual(['Q1', 'Deux'])
      expect(regenerated[1]).toMatchObject({ model_id: 'llm-b', sibling_index: 1, sibling_ids: [first.id, regenerated[1].id] })
      expect(sent(1)).toMatchObject({ settings: { model_id: 'llm-b' }, messages: [{ role: 'user', content: 'Q1' }] }) // the first answer is not in the history
      expect(await privateChatApi.siblings('c1', first.id)).toHaveLength(2)

      answer((id) => reply(id, 'Trois'))
      await run(`/chat/conversations/c1/messages/${user.id}/edit`, { content: 'Q1 bis' })
      const edited = await branch()
      expect(edited.map((m) => m.content)).toEqual(['Q1 bis', 'Trois'])
      expect(edited[0]).toMatchObject({ sibling_index: 1 })
      expect(sent(2).messages).toEqual([{ role: 'user', content: 'Q1 bis', attachments: [] }])
    })

    it('keeps the files of an edited message unless told otherwise', async () => {
      privateChats.rememberUpload(upload('chat_0123456789abcdef.md'))
      answer((id) => reply(id, 'A'))
      await send('Q', { attachments: [{ name: 'chat_0123456789abcdef.md' }] })
      const [user] = await branch()
      answer((id) => reply(id, 'B'))
      await run(`/chat/conversations/c1/messages/${user.id}/edit`, { content: 'Q2' })
      expect((await branch())[0].attachments).toHaveLength(1)
      answer((id) => reply(id, 'C'))
      await run(`/chat/conversations/c1/messages/${(await branch())[0].id}/edit`, { content: 'Q3', attachments: [] })
      expect((await branch())[0].attachments).toEqual([])
    })

    it('creates nothing when the server refuses before the answer starts (an error without an id)', async () => {
      answer(() => [block('error', { code: 'busy', message: 'Une génération est en cours.' })])
      const events = await send('Q')
      expect(events).toEqual([{ type: 'error', code: 'busy', message: 'Une génération est en cours.' }])
      expect(await branch()).toEqual([])
    })

    it('throws a ChatError for an HTTP refusal, with the code the server added, and creates nothing', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Pièce jointe introuvable', code: 'refused' }), { status: 422 }))
      await expect(send('Q')).rejects.toMatchObject({ code: 'refused', status: 422 })
      expect(await branch()).toEqual([])
    })

    it('marks the answer as failed when the error comes after it started', async () => {
      answer((id) => [block('accepted', { id }), block('delta', { id, content: 'début' }), block('error', { id, code: 'context_exceeded', message: 'Trop long.' })])
      const events = await send('Q')
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'context_exceeded', id: expect.any(String) })
      expect((await branch()).at(-1)).toMatchObject({ status: 'error', error: 'Trop long.', content: 'début' })
    })

    it('ends with an error "closed" when the stream stops without its end', async () => {
      answer((id) => [block('accepted', { id }), block('delta', { id, content: 'x' })])
      const events = await send('Q')
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'closed' })
      expect((await branch()).at(-1)).toMatchObject({ status: 'error' })
    })

    it('stops quietly when asked and keeps the text received as a cancelled answer', async () => {
      const controller = new AbortController()
      fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const { reply_id: id } = JSON.parse(init.body as string) as { reply_id: string }
        const signal = init.signal as AbortSignal
        return new Response(new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(block('accepted', { id }) + block('delta', { id, content: 'début' })))
            signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
          },
        }))
      })
      const events: ChatStreamEvent[] = []
      const running = streamPrivateAnswer('/chat/conversations/c1/messages', { content: 'Q' }, { signal: controller.signal, onEvent: (e) => events.push(e) })
      await vi.waitFor(() => expect(events.some((e) => e.type === 'delta')).toBe(true))
      controller.abort()
      await running
      expect(events.map((e) => e.type)).toEqual(['message', 'message', 'delta'])
      expect((await branch()).at(-1)).toMatchObject({ status: 'cancelled', content: 'début' })
    })

    it('aborts the answers in progress and forgets everything when the session goes', async () => {
      fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const { reply_id: id } = JSON.parse(init.body as string) as { reply_id: string }
        const signal = init.signal as AbortSignal
        return new Response(new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(block('accepted', { id })))
            signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
          },
        }))
      })
      const running = streamPrivateAnswer('/chat/conversations/c1/messages', { content: SENTINEL }, { signal: new AbortController().signal, onEvent: () => undefined })
      await vi.waitFor(() => expect(privateChats.get('c1')?.messages.size).toBe(2))
      forgetPrivateChats()
      await running
      expect(privateChats.get('c1')).toBeUndefined()
      expect(privateChats.all()).toEqual([])
    })
  })

  describe('the tree', () => {
    async function twoBranches() {
      answer((id) => reply(id, 'R1'))
      await send('Q1')
      const [user, a1] = await branch()
      answer((id) => reply(id, 'R1 bis'))
      await run(`/chat/conversations/c1/messages/${a1.id}/regenerate`, {})
      return { user, a1, a2: (await branch())[1] }
    }

    it('switches branch to the newest leaf below a message, and deletes a message with what follows it', async () => {
      const { user, a1, a2 } = await twoBranches()
      expect((await privateChatApi.setLeaf('c1', a1.id)).messages.map((m) => m.id)).toEqual([user.id, a1.id])
      expect((await privateChatApi.removeMessage('c1', a1.id)).messages.map((m) => m.id)).toEqual([user.id, a2.id]) // the sibling branch
      expect((await privateChatApi.removeMessage('c1', user.id)).messages).toEqual([])
      await expect(privateChatApi.setLeaf('c1', 'nope')).rejects.toMatchObject({ status: 404 })
    })

    it('refuses to delete while an answer is being written', async () => {
      const chat = privateChats.set('c1', { settings: { model_id: null, system_prompt: '', params: {}, context_size: null, reasoning: 'auto', tools: { web: false }, leaf_id: null }, messages: new Map() })
      const m = (id: string, status: ChatMessage['status']): ChatMessage => ({ id, conversation_id: 'c1', parent_id: null, role: 'user', content: '', reasoning: null, tool_runs: [], attachments: [], model_id: null, params: null, status, error: null, stats: null, created_at: 1, sibling_ids: [], sibling_index: 0 })
      chat.messages.set('x', m('x', 'streaming'))
      await expect(privateChatApi.removeMessage('c1', 'x')).rejects.toMatchObject({ status: 409, code: 'busy' })
    })

    it('searches the conversations of the session and exports the active branch as a file of this page', async () => {
      answer((id) => reply(id, 'La réponse contient un mot rare'))
      await send('Une question')
      expect(await privateChatApi.search('MOT RARE')).toEqual([{ conversation_id: 'c1', message_id: expect.any(String), snippet: expect.stringContaining('mot rare') }])
      expect(await privateChatApi.search('absent')).toEqual([])
      const made: Blob[] = []
      const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (made.push(blob as Blob), `blob:test/${made.length}`))
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
      const md = await privateChatApi.exportFile('c1', 'md')
      expect(md).toEqual({ href: 'blob:test/1', name: 'Conversation-privée.md' })
      expect(await made[0].text()).toBe('# Conversation privée\n\n## Vous\n\nUne question\n\n## llm-a\n\nLa réponse contient un mot rare\n')
      const json = await privateChatApi.exportFile('c1', 'json')
      expect(json.name).toBe('Conversation-privée.json')
      expect(JSON.parse(await made[1].text()).messages).toHaveLength(2)
      forgetPrivateChats() // the links of the exports are revoked with the session
      expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:test/1', 'blob:test/2'])
      create.mockRestore()
      revoke.mockRestore()
    })
  })

  it('never writes to localStorage, whatever the conversation says', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => undefined })
    answer((id) => reply(id, SENTINEL))
    await send(`question ${SENTINEL}`)
    await privateChatApi.exportFile('c1', 'md')
    expect(setItem).not.toHaveBeenCalled()
    expect(studioRequest.mock.calls.map((c) => JSON.stringify(c)).join('')).not.toContain(SENTINEL) // the shell only gets a count
  })

  it('exposes ChatError for the refusals it throws', async () => {
    await expect(run('/chat/nope', {})).rejects.toBeInstanceOf(ChatError)
  })
})
