/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({})))
const studioUpload = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest, studioUpload, studioApiBase: () => '/api' }))

import { ChatError } from '../lib/errors'
import type { ChatStreamEvent } from '../types'
import { answerPaths, chatApi, streamAnswer } from './chatApi'

const sse = (...blocks: string[]) => new Response(new Blob([blocks.join('')]).stream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const block = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

async function collect(path = '/chat/x', body = {}, signal = new AbortController().signal): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  await streamAnswer(path, body, { signal, onEvent: (e) => events.push(e) })
  return events
}

describe('chatApi', () => {
  beforeEach(() => {
    studioRequest.mockClear()
    studioUpload.mockClear()
  })

  it('reads and changes a conversation', async () => {
    await chatApi.get('c 1')
    await chatApi.patchSettings('c1', { system_prompt: 'x' })
    await chatApi.setLeaf('c1', 'm1')
    await chatApi.removeMessage('c1', 'm1')
    await chatApi.search('a b')
    await chatApi.createConversation()
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/chat/conversations/c%201'],
      ['patch', '/chat/conversations/c1/settings', { system_prompt: 'x' }],
      ['post', '/chat/conversations/c1/leaf', { message_id: 'm1' }],
      ['delete', '/chat/conversations/c1/messages/m1'],
      ['get', '/chat/search?q=a%20b'],
      ['post', '/conversations', { mode: 'chat' }],
    ])
  })

  it('starts a generation that waited for a duration or a voice', async () => {
    await chatApi.confirmGeneration('m 1', 'g1', { seconds: 4 })
    await chatApi.confirmGeneration('m1', 'g2', { voice_id: 'v1' })
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/chat/messages/m%201/generations/g1/confirm', { seconds: 4 }],
      ['post', '/chat/messages/m1/generations/g2/confirm', { voice_id: 'v1' }],
    ])
  })

  it('uploads one file as a multipart form', async () => {
    await chatApi.upload(new File(['hi'], 'a.txt', { type: 'text/plain' }))
    const [path, form] = studioUpload.mock.calls[0] as unknown as [string, FormData]
    expect(path).toBe('/chat/attachments')
    expect((form.get('file') as File).name).toBe('a.txt')
  })

  it('builds the export URL and the paths of the three ways to ask for an answer', () => {
    expect(chatApi.exportUrl('c1', 'md')).toBe('/api/chat/conversations/c1/export?format=md')
    expect(answerPaths.send('c1')).toBe('/chat/conversations/c1/messages')
    expect(answerPaths.regenerate('c1', 'm 2')).toBe('/chat/conversations/c1/messages/m%202/regenerate')
    expect(answerPaths.edit('c1', 'm2')).toBe('/chat/conversations/c1/messages/m2/edit')
  })

  it('asks for a better prompt', async () => {
    await chatApi.enhancePrompt('image', 'un chat', 'qwen')
    expect(studioRequest).toHaveBeenCalledWith('post', '/chat/enhance-prompt', { kind: 'image', prompt: 'un chat', model_id: 'qwen' })
  })
})

describe('streamAnswer', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the body as JSON and delivers every event in order', async () => {
    fetchMock.mockResolvedValue(sse(block('message', { message: { id: 'u1' } }), ': ping\n\n', block('delta', { id: 'a1', content: 'Bon' }), block('delta', { id: 'a1', content: 'jour' }), block('done', { message: { id: 'a1' } })))
    const events = await collect('/chat/conversations/c1/messages', { content: 'hi' })
    expect(events.map((e) => e.type)).toEqual(['message', 'delta', 'delta', 'done'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/conversations/c1/messages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hi' })
    expect((init.headers as Record<string, string>)['Accept']).toBe('text/event-stream')
  })

  it('turns a refusal before the stream into a ChatError with the server message and a code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ statusCode: 409, message: 'Une génération est en cours.' }), { status: 409 }))
    await expect(collect()).rejects.toMatchObject({ name: 'ChatError', code: 'busy', status: 409, message: 'Une génération est en cours.' })
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(collect()).rejects.toMatchObject({ code: 'upstream', status: 502 })
  })

  it('takes the code the server adds to a refusal, before guessing from the status', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ statusCode: 409, message: 'Pas de moteur.', code: 'no_engine' }), { status: 409 }))
    await expect(collect()).rejects.toMatchObject({ code: 'no_engine', status: 409 })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ statusCode: 422, message: 'content : message vide.', code: 'inconnu' }), { status: 422 }))
    await expect(collect()).rejects.toMatchObject({ code: 'invalid', status: 422 })
  })

  it('ends a stream that stopped without done or error with a synthetic closed error', async () => {
    fetchMock.mockResolvedValue(sse(block('delta', { id: 'a1', content: 'Bon' })))
    const events = await collect()
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'closed' })
  })

  it('does not add one after a proper end', async () => {
    fetchMock.mockResolvedValue(sse(block('error', { code: 'context_exceeded', message: 'trop long' })))
    expect(await collect()).toEqual([{ type: 'error', code: 'context_exceeded', message: 'trop long', id: undefined }])
  })

  it('reports a network failure as an engine error, and stays quiet when the caller aborted', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(collect()).rejects.toBeInstanceOf(ChatError)
    const controller = new AbortController()
    controller.abort()
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    expect(await collect('/chat/x', {}, controller.signal)).toEqual([])
  })
})
