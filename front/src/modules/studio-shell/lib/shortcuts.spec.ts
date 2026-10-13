/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { isTypingTarget, resolveShortcut, type KeyLike } from './shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })
const free = { typing: false, blocked: false }

describe('resolveShortcut', () => {
  it('Cmd/Ctrl+B toggles the sidebar', () => {
    expect(resolveShortcut(key('b', { metaKey: true }), free)).toBe('toggleSidebar')
    expect(resolveShortcut(key('B', { ctrlKey: true }), free)).toBe('toggleSidebar')
  })

  it('Cmd+Shift+O starts a new creation, with or without caps', () => {
    expect(resolveShortcut(key('O', { metaKey: true, shiftKey: true }), free)).toBe('newCreation')
    expect(resolveShortcut(key('o', { ctrlKey: true, shiftKey: true }), free)).toBe('newCreation')
    expect(resolveShortcut(key('o', { metaKey: true }), free)).toBeNull()
  })

  it('Cmd+K focuses the search', () => {
    expect(resolveShortcut(key('k', { metaKey: true }), free)).toBe('focusSearch')
  })

  it('modifier shortcuts work while typing or with a dialog open', () => {
    expect(resolveShortcut(key('b', { metaKey: true }), { typing: true, blocked: true })).toBe('toggleSidebar')
  })

  it('"/" focuses the composer, unless typing or blocked', () => {
    expect(resolveShortcut(key('/'), free)).toBe('focusComposer')
    expect(resolveShortcut(key('/'), { typing: true, blocked: false })).toBeNull()
    expect(resolveShortcut(key('/'), { typing: false, blocked: true })).toBeNull()
  })

  it('ignores other keys and Alt combinations', () => {
    expect(resolveShortcut(key('a'), free)).toBeNull()
    expect(resolveShortcut(key('b', { metaKey: true, altKey: true }), free)).toBeNull()
    expect(resolveShortcut(key('/', { metaKey: true }), free)).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('detects fields through closest()', () => {
    expect(isTypingTarget({ closest: () => ({}) } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ closest: () => null } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({} as EventTarget)).toBe(false)
  })
})
