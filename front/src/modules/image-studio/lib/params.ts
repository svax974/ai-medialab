/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { defaultValues } from '@/modules_shared/common/components/ui/schemaform/schemaControls'
import type { ParamField, ParamsSchema, ParamValue, ParamValues } from '@/modules_shared/common/components/ui/schemaform/schemaTypes'
import type { ModelInfo, ParamSpec } from '@/modules/model-catalog'
import { paramHelp, type Translator } from '@/modules/studio-core/lib/paramHelp'
import type { GenParams } from '@/modules/studio-core/types'

/**
 * Parameters a generation will use: the model's defaults, then the user's saved choices. With references the default
 * definition is "Original" (0: keep the size of the source image) and the format follows the first reference (`auto`);
 * without, `auto` makes no sense and falls back to a square.
 */
export function effectiveParams(model: ModelInfo, stored: GenParams | undefined, hasRefs: boolean): GenParams {
  const defaults: GenParams = Object.fromEntries(model.params.map((p) => [p.key, p.default]))
  const merged: GenParams = { ...defaults, megapixels: model.default_megapixels, ...stored }
  if (hasRefs && stored?.megapixels === undefined) merged.megapixels = 0
  if (!merged.aspect || (merged.aspect === 'auto' && !hasRefs)) merged.aspect = hasRefs ? 'auto' : '1:1'
  return merged
}

function fieldOf(spec: ParamSpec, model: ModelInfo, t: Translator): ParamField {
  const base = { key: spec.key, label: spec.label, advanced: spec.advanced, help: paramHelp(spec, model.kind, t) }
  if (spec.type === 'bool') return { ...base, type: 'bool', default: Boolean(spec.default) }
  if (spec.type === 'text') return { ...base, type: 'text', default: String(spec.default ?? ''), placeholder: spec.help }
  return { ...base, type: spec.type, default: Number(spec.default), min: spec.min ?? undefined, max: spec.max ?? undefined, step: spec.step ?? undefined }
}

/** Settings schema of a model for the common form: its parameters, minus those that need a reference when there is none. */
export function toParamsSchema(model: ModelInfo, hasRefs: boolean, t: Translator): ParamsSchema {
  return model.params.filter((spec) => !spec.requires_references || hasRefs).map((spec) => fieldOf(spec, model, t))
}

/** The values of a parameter set that the schema knows, in the form's type (anything else is not shown). */
export function paramValues(params: GenParams, schema: ParamsSchema): ParamValues {
  const values: Record<string, ParamValue | undefined> = {}
  for (const field of schema) {
    const value = params[field.key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[field.key] = value
  }
  return values
}

/**
 * Whether a change from the form is its "Default values" button: the common form then sends every field at its default.
 * (A single-field schema cannot tell it from an edit, so it never counts as a reset.)
 */
export function isFullReset(schema: ParamsSchema, patch: Record<string, ParamValue>): boolean {
  if (schema.length < 2) return false
  const defaults = defaultValues(schema)
  return schema.every((field) => field.key in patch && patch[field.key] === defaults[field.key])
}

/** Body `params` of a message: the effective parameters and the pinned seed (`null`: random). */
export function sendParams(params: GenParams, seed: number | null): GenParams {
  return { ...params, seed }
}
