/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { message } from '../lib/fixtures'
import { HOME_DRAFT, SEEN_LIMIT, useChatDraftStore } from './chatDraftStore'
import { BASE_SETTINGS, useChatDefaultsStore } from './chatDefaultsStore'

const reset = () => useChatDraftStore.setState({ texts: {}, attachments: {}, pending: null, seen: {} })

describe('chat draft store', () => {
  beforeEach(reset)

  it('keeps the unsent text of each conversation apart, and forgets an emptied one', () => {
    const { setText } = useChatDraftStore.getState()
    setText('c1', 'Bonjour')
    setText(HOME_DRAFT, 'Une idée')
    expect(useChatDraftStore.getState().texts).toEqual({ c1: 'Bonjour', [HOME_DRAFT]: 'Une idée' })
    setText('c1', '')
    expect(useChatDraftStore.getState().texts).toEqual({ [HOME_DRAFT]: 'Une idée' })
  })

  it('clears the text and the attachments of a draft once sent', () => {
    const s = useChatDraftStore.getState()
    s.setText('c1', 'x')
    s.setAttachments('c1', [{ kind: 'text', name: 'a.txt', mime: 'text/plain', size: 1 }])
    useChatDraftStore.getState().clear('c1')
    expect(useChatDraftStore.getState().texts).toEqual({})
    expect(useChatDraftStore.getState().attachments).toEqual({})
  })

  it('remembers the messages seen but not those still being written', () => {
    useChatDraftStore.getState().remember([message('a'), message('b', { status: 'streaming' })])
    expect(Object.keys(useChatDraftStore.getState().seen)).toEqual(['a'])
  })

  it('keeps at most SEEN_LIMIT messages, the most recent', () => {
    const many = Array.from({ length: SEEN_LIMIT + 5 }, (_, i) => message(`m${i}`))
    useChatDraftStore.getState().remember(many)
    const ids = Object.keys(useChatDraftStore.getState().seen)
    expect(ids).toHaveLength(SEEN_LIMIT)
    expect(ids).not.toContain('m0')
    expect(ids).toContain(`m${SEEN_LIMIT + 4}`)
  })

  it('hands a send from the home page to the conversation page, once', () => {
    const pending = { conversationId: 'c9', body: { content: 'hi' }, draftKey: HOME_DRAFT, modelId: 'qwen', requestedContext: 16384 }
    useChatDraftStore.getState().setPending(pending)
    expect(useChatDraftStore.getState().pending).toEqual(pending)
    useChatDraftStore.getState().setPending(null)
    expect(useChatDraftStore.getState().pending).toBeNull()
  })
})

describe('chat defaults store', () => {
  it('starts a new conversation with the base settings and merges the edits of the home page', () => {
    useChatDefaultsStore.setState({ settings: BASE_SETTINGS })
    useChatDefaultsStore.getState().merge({ system_prompt: 'Sois bref', tools: { web: true } })
    expect(useChatDefaultsStore.getState().settings).toMatchObject({ system_prompt: 'Sois bref', tools: { web: true }, reasoning: 'auto', model_id: null })
  })
})
