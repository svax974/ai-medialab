/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { DownloadProgress, ModelInfo } from '../types'

/** A running download: the live one (event stream) wins over the one the catalogue reported. */
export function activeDownload(live: DownloadProgress | undefined, model: Pick<ModelInfo, 'download'>): DownloadProgress | null {
  if (live && live.state === 'running') return live
  return model.download?.state === 'running' ? model.download : null
}

/** The error of the last attempt, from the live state first, then the catalogue. */
export function downloadError(live: DownloadProgress | undefined, model: Pick<ModelInfo, 'download'>): string | null {
  if (live?.state === 'error') return live.error
  return model.download?.state === 'error' ? model.download.error : null
}

/** Live downloads by model id after a `download.progress` event. */
export function upsertDownload(downloads: Record<string, DownloadProgress>, progress: DownloadProgress): Record<string, DownloadProgress> {
  return { ...downloads, [progress.model_id]: progress }
}

/** Whether the event ends the download (the catalogue must be re-read: installed, or error to show). */
export const isDownloadFinished = (progress: Pick<DownloadProgress, 'state'>): boolean => progress.state !== 'running'

/** Narrows an event payload to a download progress (the stream carries untrusted JSON). */
export function parseDownloadProgress(data: unknown): DownloadProgress | null {
  const d = data as Partial<DownloadProgress> | null | undefined
  if (!d || typeof d.model_id !== 'string' || typeof d.state !== 'string') return null
  return {
    model_id: d.model_id,
    state: d.state,
    done: Number(d.done ?? 0),
    total: Number(d.total ?? 0),
    rate: Number(d.rate ?? 0),
    eta: d.eta ?? null,
    error: d.error ?? null,
  }
}
