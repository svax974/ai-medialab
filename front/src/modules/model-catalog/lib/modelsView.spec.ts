/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../types'
import { groupModelsByKind, onDisk } from './modelsView'

const model = (id: string, kind: ModelInfo['kind'], install: ModelInfo['install'] = 'missing'): ModelInfo => ({ id, name: id, kind, install }) as ModelInfo

describe('groupModelsByKind', () => {
  it('orders the categories chat, audio, image, video and drops the empty ones', () => {
    const groups = groupModelsByKind([model('v', 'video'), model('i', 'image'), model('l', 'llm')])
    expect(groups.map((g) => g.kind)).toEqual(['llm', 'image', 'video'])
  })

  it('lists installed models first, then partial ones, then the others, each by name', () => {
    const [group] = groupModelsByKind([model('c', 'image'), model('b', 'image', 'partial'), model('z', 'image', 'installed'), model('a', 'image', 'installed')])
    expect(group.models.map((m) => m.id)).toEqual(['a', 'z', 'b', 'c'])
  })
})

describe('onDisk', () => {
  it('keeps installed and partial models', () => {
    expect(onDisk([model('a', 'image', 'installed'), model('b', 'image', 'partial'), model('c', 'image')]).map((m) => m.id)).toEqual(['a', 'b'])
  })
})
