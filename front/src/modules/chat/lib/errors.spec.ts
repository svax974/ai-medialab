/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { ChatError, chatErrorInfo, codeOfStatus } from './errors'
import { hostOf, isRemoteImage, isSafeHref } from './markdownSafety'
import { estimateTokens } from './estimate'

describe('chatErrorInfo', () => {
  it('gives each code of the contract a text and the action that helps', () => {
    expect(chatErrorInfo('no_engine')).toEqual({ key: 'chat.error.noEngine', action: 'install-engine' })
    expect(chatErrorInfo('context_exceeded').action).toBe('raise-context')
    expect(chatErrorInfo('no_model').action).toBe('choose-model')
    expect(chatErrorInfo('busy').key).toBe('chat.error.busy')
  })

  it('treats a code it does not know as an engine error', () => {
    expect(chatErrorInfo('whatever').key).toBe('chat.error.upstream')
  })
})

describe('codeOfStatus', () => {
  it('tells what a refusal before the stream means', () => {
    expect(codeOfStatus(409, 'Une génération est en cours.')).toBe('busy')
    expect(codeOfStatus(409, 'Le moteur llama.cpp n\'est pas installé.')).toBe('no_engine')
    expect(codeOfStatus(409, 'Aucun modèle installé.')).toBe('no_model')
    expect(codeOfStatus(409, 'A generation is in progress.')).toBe('busy')
    expect(codeOfStatus(409, 'The chat engine (llama.cpp) is not installed.')).toBe('no_engine')
    expect(codeOfStatus(409, 'No model installed.')).toBe('no_model')
    expect(codeOfStatus(422, 'content: texte attendu')).toBe('invalid')
    expect(codeOfStatus(502, 'bad gateway')).toBe('upstream')
    expect(codeOfStatus(0, 'offline')).toBe('upstream')
  })

  it('carries the status and the code in the error', () => {
    const error = new ChatError('x', 'busy', 409)
    expect([error.code, error.status, error.name]).toEqual(['busy', 409, 'ChatError'])
  })
})

describe('what an answer may link to or load', () => {
  it('opens web and mail links only', () => {
    expect(isSafeHref('https://example.org/a')).toBe(true)
    expect(isSafeHref('http://example.org')).toBe(true)
    expect(isSafeHref('mailto:a@b.c')).toBe(true)
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('  JavaScript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html;base64,AAAA')).toBe(false)
    expect(isSafeHref('file:///etc/passwd')).toBe(false)
    expect(isSafeHref(undefined)).toBe(false)
  })

  it('blocks images from the network until asked', () => {
    expect(isRemoteImage('https://tracker.example/pixel.png')).toBe(true)
    expect(isRemoteImage('//tracker.example/pixel.png')).toBe(true)
    expect(isRemoteImage('data:image/png;base64,AAAA')).toBe(false)
  })

  it('shows the host of a link', () => {
    expect(hostOf('https://docs.example.org/a/b?c=d')).toBe('docs.example.org')
    expect(hostOf('not a url')).toBe('not a url')
  })
})

describe('estimateTokens', () => {
  it('is zero for nothing and grows with the text', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('   ')).toBe(0)
    expect(estimateTokens('a'.repeat(36))).toBe(10)
  })
})
