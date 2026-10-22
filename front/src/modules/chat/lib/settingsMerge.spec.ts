/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { settings } from './fixtures'
import { mergePatches, mergeSettings } from './settingsMerge'

describe('mergeSettings', () => {
  it('switches one tool without touching the other', () => {
    expect(mergeSettings(settings({ tools: { web: true, creation: true } }), { tools: { creation: false } }).tools).toEqual({ web: true, creation: false })
    expect(mergeSettings(settings(), { tools: { web: true } }).tools).toEqual({ web: true, creation: true })
  })

  it('replaces the other members and keeps the tools when the patch has none', () => {
    const merged = mergeSettings(settings({ tools: { web: true, creation: false } }), { reasoning: 'low' })
    expect(merged).toMatchObject({ reasoning: 'low', tools: { web: true, creation: false } })
  })
})

describe('mergePatches', () => {
  it('accumulates the switches of two patches, the later winning', () => {
    expect(mergePatches({ tools: { web: true }, reasoning: 'low' }, { tools: { creation: false }, reasoning: 'off' })).toEqual({ tools: { web: true, creation: false }, reasoning: 'off' })
    expect(mergePatches({ reasoning: 'low' }, { context_size: 8192 })).toEqual({ reasoning: 'low', context_size: 8192 })
  })
})
