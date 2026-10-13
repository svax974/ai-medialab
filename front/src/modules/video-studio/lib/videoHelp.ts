/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help/helpText'
import type { VideoCaps } from '@/modules/model-catalog'
import type { VideoSlot } from '../types'

const entry = (name: string, withTip: boolean): Help => ({
  titleId: `videoStudio.help.${name}.title`,
  bodyId: `videoStudio.help.${name}.body`,
  ...(withTip ? { tipId: `videoStudio.help.${name}.tip` } : {}),
})

/** Explanations of the video composer ("?" tooltips; texts of the former `lib/help.ts`). Locale keys: `Help` of `InfoTip`/`HelpBody`. */
export const VIDEO_HELP = {
  seconds: entry('seconds', true),
  aspect: entry('aspect', false),
  resolution: entry('resolution', true),
  count: entry('count', false),
  attach: entry('attach', false),
} as const satisfies Record<string, Help>

/** Tooltip of the "Vary" button of a generation. */
export const VARY_HELP = { titleId: 'videoStudio.footer.vary.title', bodyId: 'videoStudio.footer.vary.body' } as const satisfies Help

type Translate = (key: string, params?: (string | number)[]) => string

/** Status line of a slot for a model ("Required for this model.", "Optional...", "This model does not use it."), as a locale key. */
export function slotStatusKey(slot: VideoSlot, caps: VideoCaps): string {
  if (slot === 'start') return `videoStudio.help.slot.status.start.${caps.image_input}`
  if (slot === 'end') return `videoStudio.help.slot.status.end.${caps.last_frame ? 'optional' : 'none'}`
  return `videoStudio.help.slot.status.source.${caps.video_input}`
}

/**
 * Tooltip of an empty slot: its name and whether it is required, what it does, what this model does with it, and a tip
 * (the slot's own, else how to fill it).
 */
export function slotHelp(slot: VideoSlot, caps: VideoCaps, label: string, required: boolean, t: Translate): Help {
  const role = slot === 'start' && caps.image_role === 'reference' ? ` ${t('videoStudio.help.slot.role.reference')}` : ''
  const own = slot === 'source' ? t('videoStudio.help.slot.source.tip') : undefined
  return {
    title: `${label} ${t(required ? 'videoStudio.slot.titleRequired' : 'videoStudio.slot.titleOptional')}`,
    body: `${t(`videoStudio.help.slot.${slot}.body`)}\n\n${t(slotStatusKey(slot, caps))}${role}`,
    tip: own ?? t('videoStudio.slot.tip'),
  }
}

/** Tooltip of the definition button: the generic text plus what this model offers. */
export function resolutionHelp(caps: Pick<VideoCaps, 'resolutions'>, t: Translate): Help {
  const list = caps.resolutions.map((res) => `${res.label} ≈ ${res.long_side}×${res.short_side}`).join(' · ')
  return { title: t('videoStudio.help.resolution.title'), body: `${t('videoStudio.help.resolution.body')}\n\n${t('videoStudio.format.thisModel', [list])}`, tip: t('videoStudio.help.resolution.tip') }
}

/** Starter prompts of the home page: a short label and the prompt it puts in the composer (kept word for word). */
export const VIDEO_SUGGESTIONS = [
  { labelKey: 'videoStudio.suggestion.landscape.label', promptKey: 'videoStudio.suggestion.landscape.prompt' },
  { labelKey: 'videoStudio.suggestion.portrait.label', promptKey: 'videoStudio.suggestion.portrait.prompt' },
  { labelKey: 'videoStudio.suggestion.urban.label', promptKey: 'videoStudio.suggestion.urban.prompt' },
  { labelKey: 'videoStudio.suggestion.animation.label', promptKey: 'videoStudio.suggestion.animation.prompt' },
] as const
