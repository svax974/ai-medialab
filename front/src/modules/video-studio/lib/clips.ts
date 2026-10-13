/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { VideoCaps } from '@/modules/model-catalog'
import { isActive, ratioOf } from '@/modules/studio-core/lib/messageState'
import type { Asset, GenParams, JobProgress, Message } from '@/modules/studio-core/types'
import { MAX_CLIPS } from './sendRequest'

/** One cell of a generation: a produced clip, or a clip still to come (`running`: the one being computed). */
export type ClipSlot = { kind: 'clip'; asset: Asset } | { kind: 'pending'; running: boolean }

/** Cells of a generation: one per requested clip; the missing ones of a finished generation are not drawn. */
export function clipSlots(message: Pick<Message, 'status' | 'outputs' | 'params'>, progressIndex: number | undefined): ClipSlot[] {
  const count = message.params.count ?? 1
  const active = isActive(message.status)
  const slots: ClipSlot[] = []
  for (let i = 0; i < count; i += 1) {
    const asset = message.outputs[i]
    if (asset) slots.push({ kind: 'clip', asset })
    else if (active) slots.push({ kind: 'pending', running: message.status === 'running' && i === (progressIndex ?? 0) })
  }
  return slots
}

/** Width over height of the clips of a generation: the requested format (16:9 by default). */
export function clipRatio(params: Pick<GenParams, 'aspect'>): number {
  return ratioOf(String(params.aspect ?? '16:9')) ?? 16 / 9
}

/** Columns and maximum width (px) of the grid of a generation: one clip is wider than a pair. */
export function clipLayout(slotCount: number, ratio: number): { cols: 1 | 2; maxWidth: number } {
  const cols = slotCount <= 1 ? 1 : 2
  const maxWidth = cols === 1 ? Math.min(680, 520 * Math.sqrt(ratio)) : cols * Math.min(340, 290 * Math.sqrt(ratio))
  return { cols, maxWidth }
}

/** Share of the current clip done (0..1). */
export function clipFraction(progress: Pick<JobProgress, 'step' | 'total'> | undefined, running: boolean): number {
  return running && progress?.total ? (progress.step ?? 0) / progress.total : 0
}

/** Label inside a clip still to come: the model loading, the step, preparing, or waiting its turn. */
export function pendingLabel(status: Message['status'], running: boolean, progress: Pick<JobProgress, 'step' | 'total'> | undefined): { key: string; params?: (string | number)[] } {
  if (status === 'loading') return { key: 'videoStudio.pending.loading' }
  if (!running) return { key: 'videoStudio.pending.waiting' }
  return progress?.step ? { key: 'videoStudio.pending.step', params: [progress.step, progress.total ?? 0] } : { key: 'thread.status.preparing' }
}

/** A clip produced less than 8 s ago is revealed with the "develop" animation. */
export function isFreshClip(asset: Pick<Asset, 'created_at'>, nowSeconds: number): boolean {
  return nowSeconds - asset.created_at < 8
}

/** A clip's own ratio once known (its pixels), else the requested format. */
export function assetRatio(asset: Pick<Asset, 'width' | 'height'>, fallback: number): number {
  return asset.width && asset.height ? asset.width / asset.height : fallback
}

/** What the engine is doing while no step is counted: fetching the fast decoder, decoding (can be long), encoding the MP4, sampling. */
export function stageKey(stage: JobProgress['stage'] | undefined, fastDecode: boolean): string {
  if (stage === 'fetch') return 'videoStudio.stage.fetch'
  if (stage === 'decode') return fastDecode ? 'videoStudio.stage.decodeFast' : 'videoStudio.stage.decode'
  if (stage === 'encode') return 'videoStudio.stage.encode'
  if (stage === 'sampling') return 'videoStudio.stage.sampling'
  return 'thread.status.preparing'
}

/** What the line next to the model name says for a video message. The component turns each kind into text. */
export type VideoStatus =
  | { kind: 'queued'; position: number | null }
  | { kind: 'loading'; elapsed: number; downloadable: boolean }
  | { kind: 'running'; step: number | null; total: number | null; stageKey: string; clip: number | null; eta: number | null }
  | { kind: 'meta'; size: string | null; seconds: number | null; steps: number | null; duration: number | null; createdAt: number }

export function videoStatus(
  message: Message,
  progress: JobProgress | undefined,
  context: { now: number; queueIndex: number; modelInstalled: boolean; caps: Pick<VideoCaps, 'resolutions'> | null | undefined },
): VideoStatus {
  const p = message.params
  if (message.status === 'queued') return { kind: 'queued', position: context.queueIndex > 0 ? context.queueIndex + 1 : null }
  if (message.status === 'loading') return { kind: 'loading', elapsed: context.now - (progress?.load_started_at ?? message.started_at ?? context.now), downloadable: !context.modelInstalled }
  if (message.status === 'running') {
    const count = p.count ?? 1
    return {
      kind: 'running',
      step: progress?.step ? progress.step : null,
      total: progress?.total ?? null,
      stageKey: stageKey(progress?.stage, !!p['fast_decode']),
      clip: count > 1 ? (progress?.index ?? 0) + 1 : null,
      eta: progress?.eta != null && progress.step ? progress.eta : null,
    }
  }
  const resolution = context.caps?.resolutions.find((res) => res.id === p['resolution'])?.label ?? null
  return {
    kind: 'meta',
    size: p.width && p.height ? `${p.width}×${p.height}` : resolution,
    seconds: typeof p['seconds'] === 'number' ? p['seconds'] : null,
    steps: p.steps || null,
    duration: message.status === 'done' && message.finished_at && message.started_at ? message.finished_at - message.started_at : null,
    createdAt: message.created_at,
  }
}

/** Composer values that "Reuse these settings" restores from a finished generation. */
export interface ReusedVideo {
  modelId: string
  prompt: string
  params: GenParams
  count: number | null
  seed: number | null
  start: Asset | null
  end: Asset | null
  source: Asset | null
}

/** Engine-computed values that are not settings (the engine derives them again from the duration). */
const DERIVED = ['seeds', 'count', 'seed', 'references_used', 'width', 'height', 'frames', 'fps', 'task'] as const

/**
 * Settings of a generation, ready for the composer: parameters without the derived values, the number of clips (two at most), the
 * first seed (pinned), and the inputs of the prompt that started it (images in order: start then end; the video: source).
 * `null` without a model.
 */
export function reusedVideo(message: Pick<Message, 'model_id' | 'params' | 'prompt' | 'references'>, parentReferences: readonly Asset[]): ReusedVideo | null {
  if (!message.model_id) return null
  const params: GenParams = { ...message.params }
  for (const key of DERIVED) delete params[key]
  const refs = message.references.length > 0 ? message.references : parentReferences
  const images = refs.filter((ref) => ref.media !== 'video')
  const count = message.params.count
  return {
    modelId: message.model_id,
    prompt: message.prompt,
    params,
    count: count ? Math.min(MAX_CLIPS, count) : null,
    seed: message.params.seeds?.[0] ?? null,
    start: images[0] ?? null,
    end: images[1] ?? null,
    source: refs.find((ref) => ref.media === 'video') ?? null,
  }
}
