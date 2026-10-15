/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ParamField, ParamsSchema, ParamValue, ParamValues } from '@/modules_shared/common/components/ui/schemaform'
import type { LlmCaps } from '@/modules/model-catalog'
import type { ReasoningLevel, SamplingParams } from '../types'

/** Numeric sampling parameters the settings panel edits (the seed and the stop list have their own fields). */
export type SamplingKey = 'temperature' | 'top_p' | 'top_k' | 'min_p' | 'repeat_penalty' | 'presence_penalty' | 'frequency_penalty' | 'max_tokens'

/**
 * What a parameter that was never set means: llama.cpp's server defaults (the engine forwards only what is set).
 * `max_tokens` 0 stands for "no limit". Taken from llama-server's documentation, not measured on the installed build.
 */
export const SAMPLING_DEFAULTS: Record<SamplingKey, number> = {
  temperature: 0.8,
  top_p: 0.95,
  top_k: 40,
  min_p: 0.05,
  repeat_penalty: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
  max_tokens: 0,
}

export type SamplingPresetId = 'precise' | 'balanced' | 'creative'

/** Ready-made settings: precise answers, a balance, creative writing. */
export const SAMPLING_PRESETS: Record<SamplingPresetId, SamplingParams> = {
  precise: { temperature: 0.2, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.05 },
  balanced: { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1 },
  creative: { temperature: 1.1, top_p: 0.95, top_k: 80, min_p: 0.02, repeat_penalty: 1 },
}

export const PRESET_IDS: readonly SamplingPresetId[] = ['precise', 'balanced', 'creative']

const KEYS = Object.keys(SAMPLING_DEFAULTS) as SamplingKey[]

/** The value a field shows: what the user set, else the default. */
export function shown(params: SamplingParams, key: SamplingKey): number {
  return params[key] ?? SAMPLING_DEFAULTS[key]
}

/** The preset whose values the parameters match (those it does not name at their default), if any. */
export function activePreset(params: SamplingParams): SamplingPresetId | null {
  return PRESET_IDS.find((id) => KEYS.every((key) => shown(params, key) === (SAMPLING_PRESETS[id][key] ?? SAMPLING_DEFAULTS[key]))) ?? null
}

/** Values for the schema form. */
export function schemaValues(params: SamplingParams): ParamValues {
  return Object.fromEntries(KEYS.map((key) => [key, shown(params, key)]))
}

/** Applies a change of the schema form to the stored parameters: a value back at its default is dropped (the server's default applies). */
export function applyChange(params: SamplingParams, patch: Record<string, ParamValue>): SamplingParams {
  const next: SamplingParams = { ...params }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in SAMPLING_DEFAULTS) || typeof value !== 'number') continue
    const k = key as SamplingKey
    if (value === SAMPLING_DEFAULTS[k]) delete next[k]
    else next[k] = value
  }
  return next
}

const help = (name: string) => ({ titleId: `chat.params.${name}`, bodyId: `chat.params.${name}.help` })
const num = (key: SamplingKey, min: number, max: number, step: number, type: 'int' | 'float', advanced = false): ParamField => ({
  key,
  labelId: `chat.params.${key}`,
  help: help(key),
  type,
  default: SAMPLING_DEFAULTS[key],
  min,
  max,
  step,
  advanced,
})

/** The settings panel's numeric fields (the model's own settings that are not sampling are in the panel's body). */
export const PARAMS_SCHEMA: ParamsSchema = [
  num('temperature', 0, 2, 0.05, 'float'),
  num('top_p', 0, 1, 0.01, 'float'),
  num('top_k', 0, 200, 1, 'int'),
  num('max_tokens', 0, 32768, 64, 'int'),
  num('min_p', 0, 1, 0.01, 'float', true),
  num('repeat_penalty', 0.8, 1.6, 0.05, 'float', true),
  num('presence_penalty', -2, 2, 0.1, 'float', true),
  num('frequency_penalty', -2, 2, 0.1, 'float', true),
]

/** Thinking levels a model offers, from its capability; none for a model that does not think. */
export function reasoningChoices(caps: Pick<LlmCaps, 'reasoning'> | null | undefined): ReasoningLevel[] {
  switch (caps?.reasoning) {
    case 'toggle':
      return ['auto', 'off']
    case 'always':
      return ['auto']
    case 'levels':
      return ['auto', 'off', 'low', 'medium', 'high']
    default:
      return []
  }
}

/** Personas: a system prompt each (the texts are in the locales: `chat.persona.<id>` and `.prompt`). */
export const PERSONA_IDS = ['assistant', 'reviewer', 'translator', 'developer', 'writer', 'imagePrompter'] as const
export type PersonaId = (typeof PERSONA_IDS)[number]
