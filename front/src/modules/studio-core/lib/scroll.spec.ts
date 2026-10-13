/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { isNearBottom, resolveTitleEdit, scrollAction } from './scroll'

describe('isNearBottom', () => {
  it('is true within 80 px of the bottom and false beyond', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 521, clientHeight: 400 })).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 520, clientHeight: 400 })).toBe(false)
    expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true)
  })
})

describe('scrollAction', () => {
  it('jumps when the conversation opens, scrolls smoothly on a new message, else nothing', () => {
    expect(scrollAction(0, 5)).toBe('jump')
    expect(scrollAction(0, 0)).toBe('jump')
    expect(scrollAction(5, 6)).toBe('smooth')
    expect(scrollAction(5, 5)).toBeNull()
    expect(scrollAction(5, 4)).toBeNull()
  })
})

describe('resolveTitleEdit', () => {
  it('reverts an empty title, ignores an unchanged one and saves the trimmed new one', () => {
    expect(resolveTitleEdit('   ', 'Old')).toEqual({ action: 'revert' })
    expect(resolveTitleEdit(' Old ', 'Old')).toEqual({ action: 'none' })
    expect(resolveTitleEdit(' New title ', 'Old')).toEqual({ action: 'save', title: 'New title' })
  })
})
