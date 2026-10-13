/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useSystemInfo } from '@/modules/hardware'
import type { ModelInfo, ModelKind } from '@/modules/model-catalog'
import { EnginesCard } from './EnginesCard'
import { PacksCard } from './PacksCard'

/**
 * The installers shown above the models of a tab of the models dialog: the image engines, or the audio/video packs.
 * Reads the machine description (shared with the machine card); nothing until it is loaded (the machine card shows
 * the loading and error states).
 */
export function EnginesPanel({ kind, models }: { kind: ModelKind; models: ModelInfo[] }) {
  const { data: system } = useSystemInfo({ pollMs: 8_000 })
  if (!system) return null
  return kind === 'image' ? <EnginesCard system={system} /> : <PacksCard system={system} kind={kind} models={models} />
}
