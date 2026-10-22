/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ChatSettings, ChatSettingsPatch } from '../types'

/** Settings with a patch applied: every member replaces the stored one, but `tools` is merged (a patch may switch one tool). */
export function mergeSettings(settings: ChatSettings, patch: ChatSettingsPatch): ChatSettings {
  return { ...settings, ...patch, tools: { ...settings.tools, ...patch.tools } }
}

/** Two patches in order: the later wins member by member, `tools` included. */
export function mergePatches(first: ChatSettingsPatch, second: ChatSettingsPatch): ChatSettingsPatch {
  const tools = first.tools || second.tools ? { ...first.tools, ...second.tools } : undefined
  return { ...first, ...second, ...(tools ? { tools } : {}) }
}
