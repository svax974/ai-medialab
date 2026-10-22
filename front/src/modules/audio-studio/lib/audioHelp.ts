/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help/helpText'

const entry = (name: string, withTip: boolean): Help => ({
  titleId: `audioStudio.help.${name}.title`,
  bodyId: `audioStudio.help.${name}.body`,
  ...(withTip ? { tipId: `audioStudio.help.${name}.tip` } : {}),
})

/** Explanations of the audio composer ("?" tooltips; texts of the former `lib/help.ts`). Locale keys: `Help` of `InfoTip`/`HelpBody`. */
export const AUDIO_HELP = {
  language: entry('language', false),
  voice: entry('voice', true),
  instruct: entry('instruct', true),
  instructDesign: entry('instructDesign', true),
  script: entry('script', true),
  autoplay: { bodyId: 'audioStudio.help.autoplay.body' },
} as const satisfies Record<string, Help>

type Translate = (key: string, params?: (string | number)[]) => string

/** Tooltip of the length counter: what this model reads in one go (its `max_chars`), then why long texts are cut. */
export function maxCharsHelp(maxChars: number, limit: number, lang: string, t: Translate): Help {
  const format = (n: number) => n.toLocaleString(lang)
  return { title: t('audioStudio.help.maxChars.title'), body: `${t('audioStudio.help.maxChars.lead', [format(maxChars), format(limit)])} ${t('audioStudio.help.maxChars.body')}`, tip: t('audioStudio.help.maxChars.tip') }
}

/** Tooltip of the autoplay switch: its state as the title, the explanation as the body. */
export function autoplayHelp(enabled: boolean, t: Translate): Help {
  return { title: t(enabled ? 'audioStudio.help.autoplay.on' : 'audioStudio.help.autoplay.off'), body: t('audioStudio.help.autoplay.body') }
}

/** Starter texts of the home page: a short label and the text it puts in the composer (kept word for word). */
export const AUDIO_SUGGESTIONS = [
  { labelKey: 'audioStudio.suggestion.narration.label', textKey: 'audioStudio.suggestion.narration.text' },
  { labelKey: 'audioStudio.suggestion.announcement.label', textKey: 'audioStudio.suggestion.announcement.text' },
  { labelKey: 'audioStudio.suggestion.dialogue.label', textKey: 'audioStudio.suggestion.dialogue.text' },
  { labelKey: 'audioStudio.suggestion.advert.label', textKey: 'audioStudio.suggestion.advert.text' },
] as const
