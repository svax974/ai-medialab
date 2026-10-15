/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const errors = vi.hoisted(() => ({ list: [] as string[] }))
vi.mock('react-toastify', () => ({ toast: { error: (text: string) => errors.list.push(text), success: () => undefined } }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({ i18n: { get: (key: string) => key } }))
const streamAnswer = vi.hoisted(() => vi.fn())
vi.mock('./chatApi', () => ({ streamAnswer }))

import { QueryClient } from '@tanstack/react-query'
import { ChatError } from '../lib/errors'
import { chatKeys } from '../lib/chatKeys'
import { conversation, message } from '../lib/fixtures'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { useChatDraftStore } from '../state/chatDraftStore'
import { useChatLiveStore } from '../state/chatLiveStore'
import type { ChatConversation, ChatStreamEvent } from '../types'
import { startAnswer, stopAnswer } from './answerRunner'

const request = { path: '/chat/conversations/c1/messages', body: { content: 'Salut' }, draftKey: 'c1', modelId: 'qwen', requestedContext: 16384 }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData(chatKeys.conversation('c1'), conversation([], {}))
  const invalidated: unknown[] = []
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters) => void invalidated.push(filters?.queryKey))
  return { queryClient, invalidated }
}
const cached = (queryClient: QueryClient) => queryClient.getQueryData<ChatConversation>(chatKeys.conversation('c1'))

const script = (events: ChatStreamEvent[]) =>
  streamAnswer.mockImplementation(async (_path: string, _body: unknown, options: { onEvent: (e: ChatStreamEvent) => void }) => {
    for (const event of events) options.onEvent(event)
  })

describe('startAnswer', () => {
  beforeEach(() => {
    streamAnswer.mockReset()
    errors.list.length = 0
    useChatLiveStore.setState({ streams: {}, status: null })
    useChatDraftStore.setState({ texts: { c1: 'Salut' }, attachments: {}, pending: null, seen: {} })
  })

  it('streams an answer into the cache, empties the draft once the message is saved, and refreshes the lists', async () => {
    const { queryClient, invalidated } = setup()
    const user = message('u1', { content: 'Salut' })
    const answer = message('a1', { role: 'assistant', parent_id: 'u1', status: 'streaming', model_id: 'qwen' })
    script([
      { type: 'message', message: user },
      { type: 'message', message: answer },
      { type: 'delta', id: 'a1', content: 'Bon' },
      { type: 'delta', id: 'a1', content: 'jour' },
      { type: 'title', title: 'Salutations' },
      { type: 'done', message: { ...answer, content: 'Bonjour', status: 'done' } },
    ])
    expect(startAnswer(queryClient, 'c1', request)).toBe(true)
    await flush()
    const data = cached(queryClient)
    expect(data?.messages.map((m) => [m.id, m.content, m.status])).toEqual([['u1', 'Salut', 'done'], ['a1', 'Bonjour', 'done']])
    expect(useChatDraftStore.getState().texts).toEqual({})
    expect(useChatLiveStore.getState().streams['c1']).toMatchObject({ active: false, error: null })
    expect(Object.keys(useChatDraftStore.getState().seen).sort()).toEqual(['a1', 'u1'])
    expect(invalidated).toContainEqual(studioKeys.conversations)
  })

  it('refuses a second answer while one is in progress', () => {
    const { queryClient } = setup()
    streamAnswer.mockImplementation(() => new Promise(() => undefined))
    expect(startAnswer(queryClient, 'c1', request)).toBe(true)
    expect(startAnswer(queryClient, 'c2', { ...request, path: '/chat/conversations/c2/messages' })).toBe(false)
    expect(errors.list).toEqual(['chat.error.alreadyAnswering'])
    expect(streamAnswer).toHaveBeenCalledTimes(1)
  })

  it('shows the loading of the model, and says it reloads when the context asked for is not the loaded one', async () => {
    const { queryClient } = setup()
    useChatLiveStore.setState({ status: { state: 'ready', model_id: 'qwen', context_size: 8192 } })
    let seenDuring: unknown
    streamAnswer.mockImplementation(async (_p: string, _b: unknown, options: { onEvent: (e: ChatStreamEvent) => void }) => {
      options.onEvent({ type: 'loading', phase: 'loading', model_id: 'qwen', elapsed_s: 3 })
      seenDuring = useChatLiveStore.getState().streams['c1']?.loading
      options.onEvent({ type: 'loading', phase: 'ready', model_id: 'qwen' })
    })
    startAnswer(queryClient, 'c1', request)
    await flush()
    expect(seenDuring).toMatchObject({ phase: 'loading', modelId: 'qwen', elapsed: 3, reloadContext: 16384 })
    expect(useChatLiveStore.getState().streams['c1'].loading).toBeNull()
  })

  it('keeps the draft and shows the error of a refusal before the stream', async () => {
    const { queryClient, invalidated } = setup()
    streamAnswer.mockRejectedValue(new ChatError('Une génération est en cours.', 'busy', 409))
    startAnswer(queryClient, 'c1', request)
    await flush()
    expect(useChatLiveStore.getState().streams['c1']).toMatchObject({ active: false, error: { code: 'busy', message: 'Une génération est en cours.' } })
    expect(useChatDraftStore.getState().texts).toEqual({ c1: 'Salut' })
    expect(invalidated).toContainEqual(chatKeys.conversation('c1'))
  })

  it('marks the failed message and shows the code of an error event', async () => {
    const { queryClient } = setup()
    script([
      { type: 'message', message: message('a1', { role: 'assistant', status: 'streaming' }) },
      { type: 'error', code: 'context_exceeded', message: 'trop long', id: 'a1' },
    ])
    startAnswer(queryClient, 'c1', { ...request, draftKey: undefined })
    await flush()
    expect(cached(queryClient)?.messages[0]).toMatchObject({ status: 'error', error: 'trop long' })
    expect(useChatLiveStore.getState().streams['c1'].error?.code).toBe('context_exceeded')
  })

  it('stops an answer on demand and reads the conversation again', async () => {
    const { queryClient, invalidated } = setup()
    streamAnswer.mockImplementation((_p: string, _b: unknown, options: { signal: AbortSignal }) => new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve())))
    startAnswer(queryClient, 'c1', request)
    expect(useChatLiveStore.getState().streams['c1'].active).toBe(true)
    stopAnswer('c1')
    await flush()
    expect(useChatLiveStore.getState().streams['c1'].active).toBe(false)
    expect(invalidated).toContainEqual(chatKeys.conversation('c1'))
  })
})
