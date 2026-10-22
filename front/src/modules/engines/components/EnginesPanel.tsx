/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useSystemInfo } from '@/modules/hardware'
import type { ModelInfo, ModelKind } from '@/modules/model-catalog'
import { EnginesCard } from './EnginesCard'
import { LlamacppCard } from './LlamacppCard'
import { PacksCard } from './PacksCard'

/**
 * The installers shown above the models of a tab of the models dialog: the image engines, the audio/video packs, or
 * llama.cpp for the chat models.
 * Reads the machine description (shared with the machine card); nothing until it is loaded (the machine card shows
 * the loading and error states).
 */
export function EnginesPanel({ kind, models }: { kind: ModelKind; models: ModelInfo[] }) {
  const { data: system } = useSystemInfo({ pollMs: 8_000 })
  if (!system) return null
  // "diagram" models are llama.cpp/GGUF, like "llm" (same engine binary, see engine/app/engines/diagram_models.py),
  // not an image-diffusion engine.
  if (kind === 'llm' || kind === 'diagram') return <LlamacppCard system={system} />
  return kind === 'image' ? <EnginesCard system={system} /> : <PacksCard system={system} kind={kind} models={models} />
}
