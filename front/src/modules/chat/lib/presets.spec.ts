/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { activePreset, applyChange, PARAMS_SCHEMA, reasoningChoices, SAMPLING_DEFAULTS, SAMPLING_PRESETS, schemaValues, shown } from './presets'

describe('sampling parameters', () => {
  it('shows the default of what was never set', () => {
    expect(shown({}, 'temperature')).toBe(SAMPLING_DEFAULTS.temperature)
    expect(shown({ temperature: 0.2 }, 'temperature')).toBe(0.2)
    expect(schemaValues({ top_k: 10 })).toMatchObject({ top_k: 10, temperature: SAMPLING_DEFAULTS.temperature, max_tokens: 0 })
  })

  it('stores a changed value and drops one that went back to its default', () => {
    const changed = applyChange({}, { temperature: 0.3 })
    expect(changed).toEqual({ temperature: 0.3 })
    expect(applyChange(changed, { temperature: SAMPLING_DEFAULTS.temperature })).toEqual({})
  })

  it('ignores keys and values it does not know', () => {
    expect(applyChange({ top_k: 5 }, { nope: 1, temperature: 'hot' })).toEqual({ top_k: 5 })
  })

  it('recognises the preset the parameters match, and none otherwise', () => {
    expect(activePreset({ ...SAMPLING_PRESETS.precise })).toBe('precise')
    expect(activePreset({ ...SAMPLING_PRESETS.creative })).toBe('creative')
    expect(activePreset({ ...SAMPLING_PRESETS.precise, temperature: 0.5 })).toBeNull()
    expect(activePreset({})).toBeNull()
  })

  it('has a field with bounds around its default for every parameter', () => {
    for (const field of PARAMS_SCHEMA) {
      if (field.type !== 'int' && field.type !== 'float') continue
      expect(field.min).toBeLessThanOrEqual(field.default)
      expect(field.max).toBeGreaterThanOrEqual(field.default)
      expect(field.default).toBe(SAMPLING_DEFAULTS[field.key as keyof typeof SAMPLING_DEFAULTS])
    }
  })
})

describe('reasoningChoices', () => {
  it('offers what the model supports', () => {
    expect(reasoningChoices({ reasoning: 'none' })).toEqual([])
    expect(reasoningChoices(undefined)).toEqual([])
    expect(reasoningChoices({ reasoning: 'toggle' })).toEqual(['auto', 'off'])
    expect(reasoningChoices({ reasoning: 'always' })).toEqual(['auto'])
    expect(reasoningChoices({ reasoning: 'levels' })).toContain('high')
  })
})
