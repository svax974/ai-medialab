/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest, studioUpload: vi.fn(), studioApiBase: () => '/api' }))

import { attachmentRefs, displayName, MAX_ATTACHMENTS, MAX_CONTENT_CHARS, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from '../lib/attachments'
import { conversation, message } from '../lib/fixtures'
import { CONTEXT_MIN } from '../lib/context'
import { PARAMS_SCHEMA, SAMPLING_PRESETS } from '../lib/presets'
import { applyStreamEvent, needsSettling } from '../lib/streamReducer'
import type { ChatConversation, ChatMessage, ChatStreamEvent } from '../types'
import { chatApi, streamAnswer } from './chatApi'

/**
 * Freezes the contract with the Nest `chat` module (`back/src/modules/chat/README.md`, `ChatController`, `chatValidation`,
 * `SseStream`, `ChatReplyService`): the payloads below are the shapes the server really sends, in the order it sends them.
 * A change on either side that breaks this file is a contract change to make on both.
 */

const block = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const sse = (...blocks: string[]) => new Response(new Blob([blocks.join('')]).stream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

async function read(response: Response): Promise<ChatStreamEvent[]> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  const events: ChatStreamEvent[] = []
  await streamAnswer('/chat/conversations/c1/messages', { content: 'x' }, { signal: new AbortController().signal, onEvent: (e) => events.push(e) })
  return events
}
const play = (start: ChatConversation, events: ChatStreamEvent[]): ChatConversation => events.reduce(applyStreamEvent, start)

/** A message as `chatMapper.toChatMessage` returns it. */
const wire = (id: string, extra: Partial<ChatMessage>): ChatMessage =>
  message(id, { conversation_id: 'c1', model_id: 'llm-a', params: { reasoning: 'auto' }, created_at: 1_760_000_000.5, ...extra })

afterEach(() => vi.unstubAllGlobals())

describe('the answer stream, in the order the server sends it', () => {
  it('a send: user message, answer created, loading, reasoning, text, a tool, usage, done, then the title', async () => {
    const user = wire('u1', { role: 'user', content: 'Quel temps ?', attachments: [{ kind: 'text', name: 'chat_0123456789abcdef.txt', original_name: 'notes.txt', mime: 'text/plain', size: 12 }] })
    const streaming = wire('a1', { role: 'assistant', parent_id: 'u1', status: 'streaming' })
    const run = { id: 'call_1', name: 'web_search' as const, arguments: { query: 'météo Paris' }, status: 'running' as const }
    const finished = wire('a1', {
      role: 'assistant', parent_id: 'u1', status: 'done', content: 'Il pleut.', reasoning: 'Je cherche.', tool_runs: [{ ...run, status: 'done', sources: [{ title: 'Météo', url: 'https://example.org' }] }],
      stats: { prompt_tokens: 40, completion_tokens: 3, tokens_per_second: 21.5, context_size: 16384, elapsed_ms: 1800 },
    })
    const events = await read(sse(
      block('message', { message: user }), block('message', { message: streaming }),
      block('loading', { phase: 'starting', model_id: 'llm-a' }), block('loading', { phase: 'loading', model_id: 'llm-a', elapsed_s: 2 }),
      block('reasoning', { id: 'a1', content: 'Je ' }), block('reasoning', { id: 'a1', content: 'cherche.' }),
      block('tool', { id: 'a1', run }), block('tool', { id: 'a1', run: finished.tool_runs[0] }),
      block('delta', { id: 'a1', content: 'Il ' }), block('delta', { id: 'a1', content: 'pleut.' }),
      block('usage', { id: 'a1', stats: finished.stats }), block('done', { message: finished }), block('title', { title: 'La météo' }),
    ))
    expect(events.map((e) => e.type)).toEqual(['message', 'message', 'loading', 'loading', 'reasoning', 'reasoning', 'tool', 'tool', 'delta', 'delta', 'usage', 'done', 'title'])
    const after = play(conversation([], {}), events)
    expect(after.messages.map((m) => [m.id, m.role, m.status])).toEqual([['u1', 'user', 'done'], ['a1', 'assistant', 'done']])
    expect(after.messages[1]).toMatchObject({ content: 'Il pleut.', reasoning: 'Je cherche.', tool_runs: [{ id: 'call_1', status: 'done' }] })
    expect(after.settings.leaf_id).toBe('a1')
    expect(after.conversation).toMatchObject({ title: 'La météo', generation_count: 2 })
    expect(after.messages[0].attachments[0]).toMatchObject({ name: 'chat_0123456789abcdef.txt', original_name: 'notes.txt' })
  })

  it('the answer is over at done: a stream cut or closed there is no error, the title only follows when there is one', async () => {
    const answer = wire('a1', { role: 'assistant', parent_id: 'u1', status: 'done', content: 'Ok' })
    expect((await read(sse(block('done', { message: answer })))).map((e) => e.type)).toEqual(['done'])
    expect((await read(sse(block('done', { message: answer }), block('title', { title: 'Un titre' })))).map((e) => e.type)).toEqual(['done', 'title'])
    const start = conversation([wire('u1', { role: 'user' }), wire('a1', { role: 'assistant', parent_id: 'u1', status: 'streaming' })])
    const [, after] = [0, play(start, [{ type: 'done', message: answer }, { type: 'title', title: 'Un titre' }])]
    expect(after.messages[1]).toMatchObject({ status: 'done', content: 'Ok' })
    expect(after.conversation.title).toBe('Un titre')
  })

  it('a refusal (busy, no_model, no_engine) is a stream of one error event, no id, and changes nothing', async () => {
    for (const code of ['busy', 'no_model', 'no_engine'] as const) {
      const events = await read(sse(block('error', { code, message: 'texte' })))
      expect(events).toEqual([{ type: 'error', code, message: 'texte', id: undefined }])
      const start = conversation([wire('u0', { role: 'user' })])
      expect(play(start, events)).toBe(start)
    }
  })

  it('an error after the answer was created names it: the text received stays, the state says error', async () => {
    const start = conversation([wire('u1', { role: 'user', content: 'Q' }), wire('a1', { role: 'assistant', parent_id: 'u1', status: 'streaming', content: 'Début' })])
    const events = await read(sse(block('error', { code: 'upstream', message: 'Le moteur a coupé.', id: 'a1' })))
    const after = play(start, events)
    expect(after.messages[1]).toMatchObject({ status: 'error', error: 'Le moteur a coupé.', content: 'Début' })
  })

  it('a regeneration is one new answer, a sibling of the old one: it takes its place at the end of the branch', async () => {
    const start = conversation([wire('u1', { role: 'user' }), wire('a1', { role: 'assistant', parent_id: 'u1', content: 'Ancienne', sibling_ids: ['a1'] })], { leaf_id: 'a1' })
    const created = wire('a2', { role: 'assistant', parent_id: 'u1', status: 'streaming', model_id: 'llm-b', sibling_ids: ['a1', 'a2'], sibling_index: 1 })
    const events = await read(sse(block('message', { message: created }), block('delta', { id: 'a2', content: 'Nouvelle' }), block('done', { message: { ...created, status: 'done', content: 'Nouvelle' } })))
    expect(events.map((e) => e.type)).toEqual(['message', 'delta', 'done'])
    const after = play(start, events)
    expect(after.messages.map((m) => m.id)).toEqual(['u1', 'a2'])
    expect(after.messages[1]).toMatchObject({ content: 'Nouvelle', model_id: 'llm-b', sibling_ids: ['a1', 'a2'], sibling_index: 1 })
    expect(after.settings.leaf_id).toBe('a2')
  })

  it('an edit is a new user message, a sibling of the old one, then its answer: what followed the old one leaves the thread', async () => {
    const start = conversation([wire('u1', { role: 'user', content: 'Avant' }), wire('a1', { role: 'assistant', parent_id: 'u1' })], { leaf_id: 'a1' })
    const user = wire('u2', { role: 'user', content: 'Après', parent_id: null, sibling_ids: ['u1', 'u2'], sibling_index: 1 })
    const answer = wire('a3', { role: 'assistant', parent_id: 'u2', status: 'streaming' })
    const events = await read(sse(block('message', { message: user }), block('message', { message: answer }), block('done', { message: { ...answer, status: 'done', content: 'Ok' } })))
    const after = play(start, events)
    expect(after.messages.map((m) => m.id)).toEqual(['u2', 'a3'])
    expect(after.messages[0].sibling_ids).toEqual(['u1', 'u2'])
  })

  it('a stopped answer: no event at all reaches the browser, the server keeps the text as `cancelled`; reading it again settles it', () => {
    const streaming = conversation([wire('u1', { role: 'user' }), wire('a1', { role: 'assistant', parent_id: 'u1', status: 'streaming', content: 'Début' })])
    expect(needsSettling(streaming)).toBe(true)
    const settled = conversation([wire('u1', { role: 'user' }), wire('a1', { role: 'assistant', parent_id: 'u1', status: 'cancelled', content: 'Début' })])
    expect(needsSettling(settled)).toBe(false)
    expect(needsSettling(conversation([wire('a1', { role: 'assistant', status: 'error', error: "Réponse interrompue par l'arrêt de l'application.", content: 'Début' })]))).toBe(false)
  })
})

describe('the calls, as the server expects them', () => {
  beforeEach(() => studioRequest.mockClear())

  it('reads the siblings of a message, unloads the model, searches (200 characters at most) and asks for a better prompt', async () => {
    await chatApi.siblings('c 1', 'm/2')
    await chatApi.unloadModel()
    await chatApi.search(`  ${'x'.repeat(300)}  `)
    await chatApi.enhancePrompt('video', 'un chien')
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/chat/conversations/c%201/messages/m%2F2/siblings'],
      ['post', '/chat/model/unload'],
      ['get', `/chat/search?q=${'x'.repeat(200)}`],
      ['post', '/chat/enhance-prompt', { kind: 'video', prompt: 'un chien' }],
    ])
  })

  it('gives attachments back by their STORED name, explicitly: [] when none is kept', () => {
    const kept = [{ kind: 'image' as const, name: 'chat_aaaaaaaaaaaaaaaa.png', original_name: 'photo.png', mime: 'image/png', size: 1 }]
    expect(attachmentRefs(kept)).toEqual([{ name: 'chat_aaaaaaaaaaaaaaaa.png' }])
    expect(attachmentRefs([])).toEqual([])
    expect(displayName(kept[0])).toBe('photo.png')
    expect(displayName({ name: 'chat_bbbbbbbbbbbbbbbb.txt', original_name: '' })).toBe('chat_bbbbbbbbbbbbbbbb.txt')
  })

  it('knows the limits the server enforces', () => {
    expect([MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, MAX_CONTENT_CHARS]).toEqual([8, 10 * 1024 * 1024, 1024 * 1024, 200_000])
    expect(CONTEXT_MIN).toBe(256)
  })

  it('offers only sampling values the server accepts (`chatValidation.PARAM_BOUNDS`)', () => {
    const server: Record<string, [number, number]> = {
      temperature: [0, 2], top_p: [0, 1], top_k: [0, 1000], min_p: [0, 1], repeat_penalty: [0, 2], presence_penalty: [-2, 2], frequency_penalty: [-2, 2], max_tokens: [1, 262_144],
    }
    for (const field of PARAMS_SCHEMA) {
      const [min, max] = server[field.key]
      // `max_tokens` 0 is "no limit": it is the default, never sent
      expect(field.max).toBeLessThanOrEqual(max)
      expect(field.key === 'max_tokens' ? 1 : (field.min ?? 0)).toBeGreaterThanOrEqual(min)
    }
    for (const preset of Object.values(SAMPLING_PRESETS)) {
      for (const [key, value] of Object.entries(preset)) {
        const [min, max] = server[key]
        expect(value as number).toBeGreaterThanOrEqual(min)
        expect(value as number).toBeLessThanOrEqual(max)
      }
    }
  })
})
