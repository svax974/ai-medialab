/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo, VideoCaps } from '@/modules/model-catalog'
import type { Asset } from '@/modules/studio-core/types'
import type { VideoSlot } from '../types'

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)$/i
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i

interface FileLike {
  name: string
  type: string
}

export const isVideoFile = (file: FileLike): boolean => file.type.startsWith('video/') || VIDEO_RE.test(file.name)
export const isImageFile = (file: FileLike): boolean => file.type.startsWith('image/') || IMAGE_RE.test(file.name)

/** What each slot needs from the model: a start image, an end image, a source video. */
export const SLOT_SUPPORT: Record<VideoSlot, (caps: VideoCaps) => boolean> = {
  start: (caps) => caps.image_input !== 'none',
  end: (caps) => caps.last_frame,
  source: (caps) => caps.video_input !== 'none',
}

/** Locale key completing "<model> ..." when the model is switched for a slot. */
export const SLOT_WHY_KEY: Record<VideoSlot, string> = {
  start: 'videoStudio.switch.start',
  end: 'videoStudio.switch.end',
  source: 'videoStudio.switch.source',
}

/**
 * When the active model cannot use this kind of input, the model to switch to: a compatible video model that can, ready
 * ones first, then the lightest download. `null` when the active model can, or when none can.
 */
export function modelSwitchFor(slot: VideoSlot, active: ModelInfo | undefined, models: readonly ModelInfo[]): ModelInfo | null {
  if (!active?.video || SLOT_SUPPORT[slot](active.video)) return null
  const better = models
    .filter((model) => model.kind === 'video' && model.video && model.compatible && SLOT_SUPPORT[slot](model.video))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0))
  return better[0] ?? null
}

export interface TakenSlots {
  start: boolean
  end: boolean
}

/** Slot of an asset put in the composer: a video is the source; an image is the start, or the end when the start is taken and the model has an end image. */
export function slotForAsset(asset: Pick<Asset, 'media'>, taken: TakenSlots, caps: VideoCaps | undefined): VideoSlot {
  if (asset.media === 'video') return 'source'
  return taken.start && !taken.end && caps?.last_frame ? 'end' : 'start'
}

export interface ImportJob<T> {
  file: T
  slot: VideoSlot
}

/** Why some files are not used: other types, several videos, more than two images (locale keys `videoStudio.import.*`). */
export type ImportWarning = 'ignoredSome' | 'oneVideo' | 'twoImages'

export interface ImportPlan<T> {
  jobs: ImportJob<T>[]
  warnings: ImportWarning[]
}

/**
 * Where imported files go: the first video is the source; at most two images are used, each in the slot it was dropped on
 * (`forced`, start or end), else the start, or the end when the start is taken and the model has an end image. Files that are
 * neither images nor videos are ignored.
 */
export function planImport<T extends FileLike>(files: readonly T[], taken: TakenSlots, caps: VideoCaps | undefined, forced?: VideoSlot): ImportPlan<T> {
  const warnings: ImportWarning[] = []
  const usable = files.filter((file) => isVideoFile(file) || isImageFile(file))
  if (usable.length < files.length) warnings.push('ignoredSome')
  const videos = usable.filter(isVideoFile)
  const images = usable.filter((file) => !isVideoFile(file))
  if (videos.length > 1) warnings.push('oneVideo')

  let startTaken = taken.start
  let endTaken = taken.end
  const jobs: ImportJob<T>[] = []
  if (videos[0]) jobs.push({ file: videos[0], slot: 'source' })
  for (const file of images.slice(0, 2)) {
    let slot: VideoSlot = forced === 'start' || forced === 'end' ? forced : 'start'
    if ((!forced || forced === 'source') && startTaken && !endTaken && caps?.last_frame) slot = 'end'
    if (slot === 'start') startTaken = true
    else endTaken = true
    jobs.push({ file, slot })
  }
  if (images.length > 2) warnings.push('twoImages')
  return { jobs, warnings }
}

/** What the file picker of each slot offers: videos for the source, images for the start and the end. */
export const SLOT_ACCEPT: Record<VideoSlot, string> = {
  source: 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.mov,.mp4,.webm',
  start: 'image/*',
  end: 'image/*',
}

/** What the paperclip offers: images and videos. */
export const ATTACH_ACCEPT = 'image/*,video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.mov,.mp4,.webm'
