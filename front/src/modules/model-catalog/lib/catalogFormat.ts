/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Accelerator } from '@/modules/hardware'
import type { ModelInfo, ModelKind } from '../types'

/** Sizes the way the old interface wrote them: megabytes under 1 GB (rounded to 10), else gigabytes. */
export type ModelSize = { unit: 'mb'; value: number } | { unit: 'gb'; value: number }

/** Download size label parts; null when unknown. `650 Mo` below 1 GB, `4,5 Go` above (10 and more: no decimal). */
export function modelSize(gb: number | null | undefined): ModelSize | null {
  if (!gb || gb <= 0) return null
  if (gb < 1) return { unit: 'mb', value: Math.max(10, Math.round((gb * 1000) / 10) * 10) }
  return { unit: 'gb', value: gb }
}

/** Approximate size used by the model picker: `~700 Mo` (hundreds, as the old interface did) or `~4 Go`. */
export function pickerSize(gb: number): ModelSize {
  return gb < 1 ? { unit: 'mb', value: Math.round(gb * 10) * 100 } : { unit: 'gb', value: Math.round(gb) }
}

/** Installed models first, then the rest; catalogue order is kept within each group. */
export function installedFirst<T extends { install: string }>(models: T[]): T[] {
  const rank = (m: T) => (m.install === 'installed' ? 0 : 1)
  return models.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m)
}

export const isTranscription = (m: Pick<ModelInfo, 'audio'>): boolean => m.audio?.task === 'stt'

/** Models of a kind, split into generators and transcription models (shown apart in the audio tab), installed first. */
export function splitModels(models: ModelInfo[], kind: ModelKind): { generators: ModelInfo[]; speech: ModelInfo[] } {
  const mine = models.filter((m) => m.kind === kind)
  return { speech: installedFirst(mine.filter(isTranscription)), generators: installedFirst(mine.filter((m) => !isTranscription(m))) }
}

export interface PickerOptions {
  /** Finished generations per model id: the most used come first. */
  usage?: Record<string, number>
  /** Also list the models too heavy for this machine (left out by default). */
  showUnfit?: boolean
  /** Id of the selected model, always listed. */
  keep?: string
}

/** A model whose weights don't fit this machine's memory (the planner's verdict). */
export const tooHeavy = (m: Pick<ModelInfo, 'plan'>): boolean => !m.plan.fits

/**
 * Models offered by a picker: the kind, never a transcription model (not a generation model); the most used first (by
 * number of generations), then the other installed ones, then the rest, catalogue order within each group. The models
 * too heavy for this machine are counted in `hidden` and left out unless `showUnfit` (the selected one always stays).
 */
export function pickerModels(models: ModelInfo[], kind: ModelKind, { usage = {}, showUnfit = false, keep }: PickerOptions = {}): { models: ModelInfo[]; hidden: number } {
  const candidates = models.filter((m) => m.kind === kind && !isTranscription(m))
  const hiddenOnes = candidates.filter((m) => tooHeavy(m) && m.id !== keep)
  const shown = showUnfit ? candidates : candidates.filter((m) => !hiddenOnes.includes(m))
  const uses = (m: ModelInfo) => usage[m.id] ?? 0
  const sorted = installedFirst(shown)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => Number(uses(b.m) > 0) - Number(uses(a.m) > 0) || uses(b.m) - uses(a.m) || a.i - b.i)
    .map(({ m }) => m)
  return { models: sorted, hidden: hiddenOnes.length }
}

/** GB still to download for the model (what is already on disk is not counted). */
export const remainingGb = (m: Pick<ModelInfo, 'download_size_gb' | 'installed_gb'>): number => Math.max(0, (m.download_size_gb ?? 0) - m.installed_gb)

/** Not enough free disk (one GB of margin) for what remains to download. */
export function lacksDiskRoom(m: ModelInfo, freeGb: number | undefined, downloading: boolean): boolean {
  const need = remainingGb(m)
  return m.install !== 'installed' && !downloading && need > 0 && freeGb != null && freeGb < need + 1
}

export type BackendLabel = { key: string; params?: string[] }

const SDCPP_DEVICE: Record<string, string> = { metal: 'Metal', cuda: 'CUDA', rocm: 'ROCm', vulkan: 'Vulkan', cpu: 'CPU' }

export interface BackendContext {
  sdcppDevice?: string
  torchDevice?: string
  accelerators?: Pick<Accelerator, 'backend'>[]
}

/** Locale key (and parameters) of the engine badge of a model card (`Metal · MLX`, `GGUF · CUDA`, `PyTorch · ROCm`...). */
export function backendLabel(m: Pick<ModelInfo, 'backend' | 'kind'>, ctx: BackendContext = {}): BackendLabel {
  if (m.backend === 'pack') return { key: m.kind === 'video' ? 'models.backend.video' : 'models.backend.audio' }
  if (m.backend === 'sdcpp') return { key: 'models.backend.sdcpp', params: [SDCPP_DEVICE[ctx.sdcppDevice ?? ''] ?? 'GPU'] }
  if (m.backend !== 'torch') return { key: `models.backend.${m.backend}` }
  if (ctx.torchDevice === 'cuda') return { key: 'models.backend.torchGpu', params: [ctx.accelerators?.[0]?.backend === 'rocm' ? 'ROCm' : 'CUDA'] }
  if (ctx.torchDevice === 'mps') return { key: 'models.backend.torchGpu', params: ['Metal'] }
  return { key: 'models.backend.torch' }
}

/** Short badge of the model picker (`MLX`, `PyTorch`, `GGUF`, `audio`, `vidéo`, `démo`). */
export function pickerBackendKey(m: Pick<ModelInfo, 'backend' | 'kind'>): string {
  return m.backend === 'pack' && m.kind === 'video' ? 'models.picker.backend.video' : `models.picker.backend.${m.backend}`
}

/** Quantization buttons of an installed MLX model: the 4/6/8 bits the model offers, then bf16 (`null`). */
export function quantizeChoices(options: number[]): (number | null)[] {
  return [...options.filter((q) => [4, 6, 8].includes(q)), null]
}

/** The note under a card is a warning unless the model is compatible and not degraded. */
export function noteIsWarning(m: Pick<ModelInfo, 'compatible' | 'plan'>): boolean {
  return !m.compatible || !!m.plan.degraded
}

/** Seconds of a clip: `5 s`, `5,5 s` (one decimal at most). */
export function formatSeconds(seconds: number, lang = 'fr'): string {
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(Math.round(seconds * 10) / 10)} s`
}

/** The GPU-capable twin of a model that only runs on the CPU here, when the note does not already name it. */
export function alternativeToShow(m: Pick<ModelInfo, 'plan'>): string | null {
  const alt = m.plan.alternative
  return m.plan.degraded && alt && !m.plan.note.includes(alt.name) ? alt.name : null
}
