/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { VideoTask } from '../types'

/** Help of the model badges (`Help` of `InfoTip`/`HelpBody`: locale keys; texts from the old `lib/help.ts`). */
export const MODEL_HELP = {
  quantize: { titleId: 'models.help.quantize.title', bodyId: 'models.help.quantize.body', tipId: 'models.help.quantize.tip' },
  variant: { titleId: 'models.help.variant.title', bodyId: 'models.help.variant.body', tipId: 'models.help.variant.tip' },
  seconds: { titleId: 'models.help.seconds.title', bodyId: 'models.help.seconds.body', tipId: 'models.help.seconds.tip' },
  resolution: { titleId: 'models.help.resolution.title', bodyId: 'models.help.resolution.body', tipId: 'models.help.resolution.tip' },
  audioOut: { titleId: 'models.help.audioOut.title', bodyId: 'models.help.audioOut.body' },
  englishOnly: { titleId: 'models.help.englishOnly.title', bodyId: 'models.help.englishOnly.body' },
  license: { titleId: 'models.help.license.title', bodyId: 'models.help.license.body' },
} as const

/** Tooltip of a video task badge. */
export const TASK_HELP_KEY: Record<VideoTask, string> = {
  t2v: 'models.video.taskHelp.t2v',
  i2v: 'models.video.taskHelp.i2v',
  v2v: 'models.video.taskHelp.v2v',
}

/** Label of a video task badge. */
export const TASK_LABEL_KEY: Record<VideoTask, string> = {
  t2v: 'models.video.task.t2v',
  i2v: 'models.video.task.i2v',
  v2v: 'models.video.task.v2v',
}
