/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help'
import type { ModelKind, ParamSpec } from '@/modules/model-catalog'

const entry = (name: string, withTip: boolean): Help => ({
  titleId: `thread.help.${name}.title`,
  bodyId: `thread.help.${name}.body`,
  ...(withTip ? { tipId: `thread.help.${name}.tip` } : {}),
})

/**
 * Explanations of the generation parameters shared by the creation modes (texts of the former `lib/help.ts`: `steps`,
 * `guidance`, `negative_prompt`, `strength`, `seed`, `fast_decode`, `count_images`) and the audio ones (`speed`, `temperature`,
 * `count_takes`, H4.5). The video parameters arrive with H4.6. Locale keys: `Help` of `InfoTip`/`HelpBody`.
 */
export const PARAM_HELP: Record<string, Help> = {
  steps: entry('steps', true),
  guidance: entry('guidance', true),
  negative_prompt: entry('negative_prompt', true),
  strength: entry('strength', true),
  seed: entry('seed', true),
  fast_decode: entry('fast_decode', true),
  count_images: entry('count_images', false),
  speed: entry('speed', false),
  temperature: entry('temperature', true),
  count_takes: entry('count_takes', true),
}

/** Texts of the engine that only repeat the generic explanation (they are not shown as "this model:"). */
const REPEATS = ['Plus d\'étapes = plus de détails, plus lent.', 'Ce que l\'image doit éviter.', 'Ce que la vidéo doit éviter.', 'Fidélité au prompt.']

export type Translator = (key: string, params?: (string | number)[]) => string

/**
 * Tooltip of a model parameter: the generic explanation of its key plus the model's own caveat (`ParamSpec.help`, written
 * by the engine, so custom models get one too) after "This model:". A parameter without generic text shows the model's
 * help alone, or its label.
 */
export function paramHelp(spec: Pick<ParamSpec, 'key' | 'label' | 'help'>, kind: ModelKind, t: Translator): Help {
  const generic = PARAM_HELP[spec.key === 'strength' && kind === 'video' ? 'strength_video' : spec.key]
  const raw = spec.help?.trim() ?? ''
  const specific = raw && !REPEATS.some((repeat) => raw.startsWith(repeat)) ? raw : ''
  if (!generic) return { title: spec.label, body: specific || spec.label }
  const body = t(generic.bodyId as string)
  return {
    title: t(generic.titleId as string),
    body: specific ? `${body}\n\n${t('thread.help.modelSays')} ${specific}` : body,
    ...(generic.tipId ? { tip: t(generic.tipId) } : {}),
  }
}
