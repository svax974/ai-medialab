/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { canApply, canUndo, enhanceFailure, enhanceFailureKey, enhanceState } from './enhance'

describe('enhanceFailure', () => {
  it('takes the code the server adds to its 409 refusal', () => {
    expect(enhanceFailure({ code: 'busy', message: 'Une génération est en cours.' })).toEqual({ code: 'busy', message: 'Une génération est en cours.' })
    expect(enhanceFailure({ code: 'no_model', message: 'x' }).code).toBe('no_model')
    expect(enhanceFailure({ code: 'no_engine', message: 'x' }).code).toBe('no_engine')
  })

  it('treats anything else as the engine failing, whatever the error is', () => {
    expect(enhanceFailure({ code: 'inconnu', message: 'Boum' })).toEqual({ code: 'upstream', message: 'Boum' })
    expect(enhanceFailure(new Error('Failed to fetch'))).toEqual({ code: 'upstream', message: 'Failed to fetch' })
    expect(enhanceFailure(null)).toEqual({ code: 'upstream', message: '' })
    expect(enhanceFailure('texte')).toEqual({ code: 'upstream', message: '' })
  })

  it('has a help text per code', () => {
    expect(enhanceFailureKey('no_engine')).toBe('chat.enhance.error.no_engine')
  })
})

describe('enhanceState', () => {
  it('is ready with a prompt and an installed chat model; says which is missing otherwise (the model first)', () => {
    expect(enhanceState('un chat', true)).toBe('ready')
    expect(enhanceState('  ', true)).toBe('empty')
    expect(enhanceState('un chat', false)).toBe('no_model')
    expect(enhanceState('', false)).toBe('no_model')
  })
})

describe('undo and late answers', () => {
  it('offers to go back only while the prompt is the improved one', () => {
    const undo = { original: 'un chat', improved: 'A tabby cat, soft light' }
    expect(canUndo('A tabby cat, soft light', undo)).toBe(true)
    expect(canUndo('A tabby cat, soft light, 4k', undo)).toBe(false)
    expect(canUndo('un chat', null)).toBe(false)
  })

  it('drops an improvement that arrives after the user typed something else', () => {
    expect(canApply('un chat', 'un chat')).toBe(true)
    expect(canApply('un chat noir', 'un chat')).toBe(false)
  })
})
