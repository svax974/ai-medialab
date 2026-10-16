/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Delays offered for unloading the idle model (minutes; 0 = right away, -1 = never), in display order. */
export const KEEP_ALIVE_OPTIONS = [
  { value: 0, labelId: 'settings.keepAlive.0' },
  { value: 5, labelId: 'settings.keepAlive.5' },
  { value: 10, labelId: 'settings.keepAlive.10' },
  { value: 30, labelId: 'settings.keepAlive.30' },
  { value: -1, labelId: 'settings.keepAlive.never' },
] as const

/** Shortcut reminders (the keys are shown as in the old interface). `labelId` is a locale key. */
export const SHORTCUT_ROWS = [
  { labelId: 'settings.shortcuts.generate', keys: '↵' },
  { labelId: 'settings.shortcuts.newLine', keys: '⇧ ↵' },
  { labelId: 'settings.shortcuts.newCreation', keys: '⌘ ⇧ O' },
  { labelId: 'settings.shortcuts.search', keys: '⌘ K' },
  { labelId: 'settings.shortcuts.sidebar', keys: '⌘ B' },
  { labelId: 'settings.shortcuts.composer', keys: '/' },
  { labelId: 'settings.shortcuts.viewer', keys: '← → · I · F' },
] as const

/** Query keys. `models` belongs to the models module (H4.2): a setting change can alter what the catalogue shows. */
export const settingsKeys = {
  settings: ['settings'] as const,
  models: ['models'] as const,
}

/** Help of each setting (`Help` of `InfoTip`: locale keys). */
export const SETTINGS_HELP = {
  keepAlive: { titleId: 'settings.help.keepAlive.title', bodyId: 'settings.help.keepAlive.body' },
  previews: { titleId: 'settings.help.previews.title', bodyId: 'settings.help.previews.body' },
  lowMemory: { titleId: 'settings.help.lowMemory.title', bodyId: 'settings.help.lowMemory.body', tipId: 'settings.help.lowMemory.tip' },
  hfToken: { titleId: 'settings.help.hfToken.title', bodyId: 'settings.help.hfToken.body', tipId: 'settings.help.hfToken.tip' },
  localAi: { titleId: 'settings.help.localAi.title', bodyId: 'settings.help.localAi.body' },
  chatVoice: { titleId: 'settings.help.chatVoice.title', bodyId: 'settings.help.chatVoice.body', tipId: 'settings.help.chatVoice.tip' },
  braveKey: { titleId: 'settings.help.braveKey.title', bodyId: 'settings.help.braveKey.body', tipId: 'settings.help.braveKey.tip' },
} as const
