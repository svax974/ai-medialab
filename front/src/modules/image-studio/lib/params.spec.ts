/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo, ParamSpec } from '@/modules/model-catalog'
import { effectiveParams, sendParams } from './params'

const spec = (extra: Partial<ParamSpec>): ParamSpec => ({ key: 'steps', label: 'Étapes', type: 'int', default: 8, min: 1, max: 50, step: 1, help: '', advanced: false, requires_references: false, ...extra })
const model = (params: ParamSpec[]): ModelInfo => ({ id: 'flux', kind: 'image', name: 'Flux', default_megapixels: 1, params }) as ModelInfo

const flux = model([spec({}), spec({ key: 'guidance', label: 'Guidance', type: 'float', default: 3.5, min: 0, max: 10, step: 0.5 }), spec({ key: 'strength', label: 'Influence', type: 'float', default: 0.7, min: 0, max: 1, step: 0.05, requires_references: true, advanced: true }), spec({ key: 'negative_prompt', label: 'Prompt négatif', type: 'text', default: '', min: null, max: null, step: null, help: 'Ce que l\'image doit éviter.' }), spec({ key: 'fast', label: 'Rapide', type: 'bool', default: true })])

describe('effectiveParams', () => {
  it('starts from the model defaults and a square at the default definition', () => {
    expect(effectiveParams(flux, undefined, false)).toEqual({ steps: 8, guidance: 3.5, strength: 0.7, negative_prompt: '', fast: true, megapixels: 1, aspect: '1:1' })
  })

  it('lets the user choices win', () => {
    expect(effectiveParams(flux, { steps: 4, aspect: '16:9', megapixels: 1.6 }, false)).toMatchObject({ steps: 4, aspect: '16:9', megapixels: 1.6 })
  })

  it('follows the reference with references: auto format, "Original" definition unless chosen', () => {
    expect(effectiveParams(flux, undefined, true)).toMatchObject({ aspect: 'auto', megapixels: 0 })
    expect(effectiveParams(flux, { megapixels: 1 }, true)).toMatchObject({ aspect: 'auto', megapixels: 1 })
    expect(effectiveParams(flux, { aspect: '4:5' }, true)).toMatchObject({ aspect: '4:5', megapixels: 0 })
  })

  it('drops auto when the references are gone', () => {
    expect(effectiveParams(flux, { aspect: 'auto' }, false).aspect).toBe('1:1')
  })
})

describe('sendParams', () => {
  it('adds the seed to the parameters sent', () => {
    expect(sendParams({ steps: 8 }, null)).toEqual({ steps: 8, seed: null })
    expect(sendParams({ steps: 8 }, 12)).toEqual({ steps: 8, seed: 12 })
  })
})
