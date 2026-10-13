/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { filterFiles } from '@/modules_shared/common/components/ui/filedrop/fileFilter'
import type { AssetMedia } from '../types'

/** Audio accepted for a voice sample (what the engine can decode), as MIME types and extensions. */
export const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus,.aac,.webm,.mp4'

/** Video mode accepts a start image or a source video. */
export const VIDEO_ACCEPT = 'video/*,image/*,.mp4,.mov,.webm,.mkv,.m4v,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.avif'

/** Accept list of the audio and video modes (the image mode's is `IMAGE_ACCEPT` of `image-studio`). */
export const DROP_ACCEPT: Record<Exclude<AssetMedia, 'image'>, string> = { audio: AUDIO_ACCEPT, video: VIDEO_ACCEPT }

export interface DropSplit<T> {
  accepted: T[]
  /** Locale key of the warning to show when something was ignored, or `null`. */
  warningKey: string | null
}

/**
 * Splits the files dropped on the window of the audio or video mode: audio keeps only the first sound file (a voice
 * sample), video keeps every image and video. A warning key is set when nothing usable was dropped (as before: the
 * warning only appears when no file fits).
 */
export function classifyDrop<T extends { name: string; type: string; size: number }>(mode: Exclude<AssetMedia, 'image'>, files: readonly T[]): DropSplit<T> {
  const { accepted } = filterFiles(files, { accept: DROP_ACCEPT[mode], multiple: mode === 'video' })
  const warningKey = accepted.length === 0 && files.length > 0 ? `library.drop.${mode}.ignored` : null
  return { accepted, warningKey }
}
