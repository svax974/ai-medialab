/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo, ParamSpec } from '@/modules/model-catalog'
import { isFullReset, paramValues, toParamsSchema } from './paramsSchema'

const spec = (extra: Partial<ParamSpec>): ParamSpec => ({ key: 'steps', label: 'Étapes', type: 'int', default: 8, min: 1, max: 50, step: 1, help: '', advanced: false, requires_references: false, ...extra })
const model = (params: ParamSpec[]): ModelInfo => ({ id: 'flux', kind: 'image', name: 'Flux', default_megapixels: 1, params }) as ModelInfo
const t = (key: string) => key

const flux = model([spec({}), spec({ key: 'guidance', label: 'Guidance', type: 'float', default: 3.5, min: 0, max: 10, step: 0.5 }), spec({ key: 'strength', label: 'Influence', type: 'float', default: 0.7, min: 0, max: 1, step: 0.05, requires_references: true, advanced: true }), spec({ key: 'negative_prompt', label: 'Prompt négatif', type: 'text', default: '', min: null, max: null, step: null, help: 'Ce que l\'image doit éviter.' }), spec({ key: 'fast', label: 'Rapide', type: 'bool', default: true })])

describe('toParamsSchema', () => {
  it('maps each parameter to a field with its bounds, advanced flag and help', () => {
    const schema = toParamsSchema(flux, true, t)
    expect(schema.map((f) => f.key)).toEqual(['steps', 'guidance', 'strength', 'negative_prompt', 'fast'])
    expect(schema[0]).toMatchObject({ type: 'int', default: 8, min: 1, max: 50, step: 1, advanced: false })
    expect(schema[1]).toMatchObject({ type: 'float', step: 0.5 })
    expect(schema[2]).toMatchObject({ advanced: true })
    expect(schema[3]).toMatchObject({ type: 'text', default: '' })
    expect(schema[4]).toMatchObject({ type: 'bool', default: true })
    expect(schema[0].help).toMatchObject({ title: 'thread.help.steps.title' })
  })

  it('hides the parameters that need a reference when there is none', () => {
    expect(toParamsSchema(flux, false, t).map((f) => f.key)).toEqual(['steps', 'guidance', 'negative_prompt', 'fast'])
  })

  it('leaves the bounds open when the engine gives none', () => {
    const open = toParamsSchema(model([spec({ min: null, max: null, step: null })]), false, t)[0]
    expect(open).toMatchObject({ min: undefined, max: undefined, step: undefined })
  })
})

describe('paramValues / isFullReset', () => {
  const schema = toParamsSchema(flux, true, t)

  it('keeps the values the form understands', () => {
    expect(paramValues({ steps: 4, aspect: '1:1', fast: false, weird: { a: 1 } }, schema)).toEqual({ steps: 4, fast: false })
  })

  it('recognizes the reset button (every field at its default) and not a single edit', () => {
    expect(isFullReset(schema, { steps: 8, guidance: 3.5, strength: 0.7, negative_prompt: '', fast: true })).toBe(true)
    expect(isFullReset(schema, { steps: 8 })).toBe(false)
    expect(isFullReset(schema, { steps: 4, guidance: 3.5, strength: 0.7, negative_prompt: '', fast: true })).toBe(false)
    expect(isFullReset(schema.slice(0, 1), { steps: 8 })).toBe(false)
  })
})
