/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help/helpText'

/** Explanations of the voice studio ("?" tooltips; texts of the former `lib/help.ts` for the sample and its transcript). */
export const VOICE_HELP = {
  sample: { titleId: 'voices.help.sample.title', bodyId: 'voices.help.sample.body', tipId: 'voices.help.sample.tip' },
  transcript: { titleId: 'voices.help.transcript.title', bodyId: 'voices.help.transcript.body', tipId: 'voices.help.transcript.tip' },
  language: { titleId: 'voices.help.language.title', bodyId: 'voices.help.language.body' },
} as const satisfies Record<string, Help>
