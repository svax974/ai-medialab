/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Asset, GenParams, JobProgress, Message, MessageStatus } from '../types'

/** Statuses of a generation that is still going on (the "Cancel" button, the breathing mark, the developing tiles). */
export const ACTIVE_STATUSES: readonly MessageStatus[] = ['queued', 'loading', 'running']

export const isActive = (status: MessageStatus): boolean => ACTIVE_STATUSES.includes(status)

/** Ratio "a:b" as a number, `null` when it is not a ratio (`auto`, `custom`). */
export function ratioOf(aspect: string): number | null {
  const [a, b] = aspect.split(':').map(Number)
  return a > 0 && b > 0 ? a / b : null
}

/** Width over height of the images of a generation: the resolved size once known, else the requested aspect. */
export function messageRatio(params: GenParams): number {
  if (params.width && params.height) return params.width / params.height
  return ratioOf(params.aspect ?? '1:1') ?? 1
}

/** One cell of the grid of a generation: a produced image, the one being developed, or one still waiting. */
export type Slot = { kind: 'image'; asset: Asset } | { kind: 'developing' } | { kind: 'waiting' }

/**
 * Cells of a generation: one per requested image. Produced images fill the first cells; while the generation goes on,
 * the next cell is "developing" (only when running) and the others "waiting". Nothing is shown for missing images
 * of a finished generation.
 */
export function buildSlots(message: Pick<Message, 'status' | 'outputs' | 'params'>, progressIndex: number | undefined): Slot[] {
  const count = message.params.count ?? 1
  const active = isActive(message.status)
  const slots: Slot[] = []
  for (let i = 0; i < count; i += 1) {
    const asset = message.outputs[i]
    if (asset) slots.push({ kind: 'image', asset })
    else if (active) slots.push(i === (progressIndex ?? 0) && message.status === 'running' ? { kind: 'developing' } : { kind: 'waiting' })
  }
  return slots
}

/** Columns and maximum width (px) of the grid of a generation. */
export function tileLayout(slotCount: number, ratio: number): { cols: 1 | 2; maxWidth: number } {
  const cols = slotCount <= 1 ? 1 : 2
  const maxWidth = cols === 1 ? Math.min(640, 520 * Math.sqrt(ratio)) : cols * Math.min(320, 280 * Math.sqrt(ratio))
  return { cols, maxWidth }
}

/** Share of the current image done (0..1). */
export function progressFraction(progress: Pick<JobProgress, 'step' | 'total'> | undefined): number {
  return progress?.total ? Math.min(1, Math.max(0, (progress.step ?? 0) / progress.total)) : 0
}

/** CSS filter of a preview: blur and the developer-bath tint fade as the image forms. */
export function developingFilter(fraction: number): string {
  const blur = Math.round(22 * (1 - fraction))
  return `blur(${blur}px) sepia(${0.7 * (1 - fraction)}) saturate(${1 + 0.8 * (1 - fraction)}) hue-rotate(-12deg)`
}

/** A freshly produced image is revealed with the "develop" animation (less than 8 s old). */
export function isFresh(asset: Pick<Asset, 'created_at'>, nowSeconds: number): boolean {
  return nowSeconds - asset.created_at < 8
}

/**
 * Zero-based position of a waiting message in the generation queue (`useQueueStore`: every conversation and mode, in the
 * order they will run; the running message is not in it), -1 when it is not waiting (or the queue is not known yet).
 * The first waiting message shows no position, the second shows "position 2": same rule as the former interface.
 */
export function queueIndex(queue: readonly string[], id: string): number {
  return queue.indexOf(id)
}

/** What the line under the model name says. The component turns each kind into text. */
export type StatusLine =
  | { kind: 'queued'; position: number | null }
  | { kind: 'loading'; elapsed: number; downloadable: boolean }
  | { kind: 'running'; step: number | null; total: number | null; image: number | null; eta: number | null }
  | { kind: 'meta'; size: string | null; steps: number | null; references: number | null; duration: number | null; createdAt: number }

export function statusLine(
  message: Message,
  progress: JobProgress | undefined,
  context: { now: number; queueIndex: number; modelInstalled: boolean },
): StatusLine {
  const p = message.params
  if (message.status === 'queued') return { kind: 'queued', position: context.queueIndex > 0 ? context.queueIndex + 1 : null }
  if (message.status === 'loading') {
    const since = progress?.load_started_at ?? message.started_at ?? context.now
    return { kind: 'loading', elapsed: context.now - since, downloadable: !context.modelInstalled }
  }
  if (message.status === 'running') {
    const count = p.count ?? 1
    return {
      kind: 'running',
      step: progress?.step ? progress.step : null,
      total: progress?.total ?? null,
      image: count > 1 ? (progress?.index ?? 0) + 1 : null,
      eta: progress?.eta != null && progress.step ? progress.eta : null,
    }
  }
  const duration = message.finished_at && message.started_at ? message.finished_at - message.started_at : null
  return {
    kind: 'meta',
    size: p.width && p.height ? `${p.width}×${p.height}` : null,
    steps: p.steps || null,
    references: p.references_used || null,
    duration: message.status === 'done' ? duration : null,
    createdAt: message.created_at,
  }
}

/** Composer values that "Reuse these settings" restores from a finished generation. */
export interface ReusedSettings {
  modelId: string
  params: GenParams
  count: number | null
  seed: number | null
}

/** Settings of a generation, ready for the composer (the seed is pinned to the first one used). `null` without a model. */
export function reusedSettings(message: Pick<Message, 'model_id' | 'params'>): ReusedSettings | null {
  if (!message.model_id) return null
  const { seeds, count, width, height, references_used: _used, seed: _seed, ...rest } = message.params
  void _used
  void _seed
  return {
    modelId: message.model_id,
    params: rest.aspect === 'custom' ? { ...rest, width, height } : rest,
    count: count ?? null,
    seed: seeds?.[0] ?? null,
  }
}

/** File name of a downloaded asset: slug of the prompt (or the original name), seed or id, extension of the media. */
export function downloadName(asset: Pick<Asset, 'media' | 'meta' | 'original_name' | 'seed' | 'id'>): string {
  const video = asset.media === 'video'
  const base = String(asset.meta?.['prompt'] ?? asset.original_name ?? (video ? 'video' : 'image'))
  const slug = base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '')
  return `${slug || (video ? 'video' : 'image')}-${asset.seed ?? asset.id}.${video ? 'mp4' : 'png'}`
}
