/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { TranscriptStatus } from '../types'

export const MEDIA_ACCEPT = '.mp4,.mkv,.webm,.mov,.avi,.m4v,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aac'
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024

export function isTranscriptActive(status: TranscriptStatus): boolean { return status === 'queued' || status === 'running' }
export function transcriptionModels(models: ModelInfo[]): ModelInfo[] { return models.filter((model) => model.kind === 'audio' && model.audio?.task === 'stt') }

export function fileIssue(file: Pick<File, 'name' | 'size'>): string | null {
  if (!MEDIA_ACCEPT.split(',').some((extension) => file.name.toLowerCase().endsWith(extension))) return 'transcription.error.format'
  return file.size > MAX_MEDIA_BYTES ? 'transcription.error.size' : file.size === 0 ? 'transcription.error.empty' : null
}

export function isYoutubeLink(value: string): boolean {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || value.length > 2048) return false
    const parts = url.pathname.split('/').filter(Boolean)
    if (host === 'youtu.be') return parts.length === 1 && /^[A-Za-z0-9_-]{11}$/.test(parts[0])
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return false
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null
    return Boolean(id && /^[A-Za-z0-9_-]{11}$/.test(id))
  } catch { return false }
}

export function mediaDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(value / 60)
  return `${minutes}:${String(value % 60).padStart(2, '0')}`
}
