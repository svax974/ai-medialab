/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help/helpText'

/** Explanations of the image composer ("?" tooltips; texts of the former `lib/help.ts`). Locale keys: `Help` of `InfoTip`/`HelpBody`. */
export const IMAGE_HELP = {
  aspect: { titleId: 'imageStudio.help.aspect.title', bodyId: 'imageStudio.help.aspect.body', tipId: 'imageStudio.help.aspect.tip' },
  megapixels: { titleId: 'imageStudio.help.megapixels.title', bodyId: 'imageStudio.help.megapixels.body', tipId: 'imageStudio.help.megapixels.tip' },
  sizeCustom: { titleId: 'imageStudio.help.sizeCustom.title', bodyId: 'imageStudio.help.sizeCustom.body', tipId: 'imageStudio.help.sizeCustom.tip' },
  referenceImages: { titleId: 'imageStudio.help.references.title', bodyId: 'imageStudio.help.references.body', tipId: 'imageStudio.help.references.tip' },
} as const satisfies Record<string, Help>

/** Tooltip of the paperclip: how to attach, then what the model does with the images (title of the button, body of both). */
export function attachHelp(t: (key: string) => string): Help {
  return { title: t('imageStudio.help.attach.title'), body: `${t('imageStudio.help.attach.lead')}\n\n${t('imageStudio.help.references.body')}`, tip: t('imageStudio.help.references.tip') }
}

/** Starter prompts of the home page: a short label and the prompt it puts in the composer. */
export const SUGGESTIONS = [
  { labelKey: 'imageStudio.suggestion.portrait.label', promptKey: 'imageStudio.suggestion.portrait.prompt' },
  { labelKey: 'imageStudio.suggestion.poster.label', promptKey: 'imageStudio.suggestion.poster.prompt' },
  { labelKey: 'imageStudio.suggestion.infographic.label', promptKey: 'imageStudio.suggestion.infographic.prompt' },
  { labelKey: 'imageStudio.suggestion.product.label', promptKey: 'imageStudio.suggestion.product.prompt' },
] as const
