/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { describe, expect, it } from 'vitest'
import { commandsFor, creationModels, durationBounds, generationView, withCreation } from './creation'

describe('commandsFor', () => {
  it('proposes the commands starting with what follows the slash, while it is the only word', () => {
    expect(commandsFor('/')).toEqual(['image', 'video', 'audio'])
    expect(commandsFor('/vi')).toEqual(['video'])
    expect(commandsFor('  /A')).toEqual(['audio'])
    expect(commandsFor('/image un chat')).toEqual([])
    expect(commandsFor('/zz')).toEqual([])
    expect(commandsFor('bonjour')).toEqual([])
    expect(commandsFor('')).toEqual([])
  })
})

describe('generationView', () => {
  it('maps the states of the studio message to what the card shows', () => {
    expect(['pending', 'queued', 'loading', 'running', 'done', 'error', 'cancelled'].map((state) => generationView({ state } as never))).toEqual(['pending', 'waiting', 'running', 'running', 'done', 'failed', 'stopped'])
  })
})

describe('creationModels', () => {
  it('keeps the ready models only', () => {
    expect(creationModels({ image: { id: 'flux', ready: true }, video: { id: 'wan', ready: false }, audio: undefined })).toEqual({ image: 'flux' })
    expect(creationModels({})).toEqual({})
  })
})

describe('durationBounds', () => {
  it('uses the caps of the model and keeps the default inside them', () => {
    expect(durationBounds({ min_seconds: 1, max_seconds: 8, default_seconds: 5 })).toEqual({ min: 1, max: 8, step: 0.5, initial: 5 })
    expect(durationBounds({ min_seconds: 2, max_seconds: 4, default_seconds: 9 })).toMatchObject({ initial: 4 })
    expect(durationBounds({ min_seconds: 3, max_seconds: 3, default_seconds: 3 })).toMatchObject({ min: 3, max: 3.5 })
    expect(durationBounds(null)).toEqual({ min: 1, max: 5, step: 0.5, initial: 5 })
  })
})

describe('withCreation', () => {
  it('adds the models only when the tools are on and some studio has one', () => {
    expect(withCreation({ tools: { web: false, creation: true } }, { image: 'flux' })).toEqual({ creation_models: { image: 'flux' } })
    expect(withCreation({ tools: { web: false, creation: false } }, { image: 'flux' })).toEqual({})
    expect(withCreation({ tools: { web: false, creation: true } }, {})).toEqual({})
    expect(withCreation(null, { image: 'flux' })).toEqual({})
  })
})
