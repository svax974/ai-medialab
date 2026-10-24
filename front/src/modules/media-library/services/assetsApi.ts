/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest, studioUpload, type StudioUploadOptions } from '@/modules/studio-shell/services/studioHttp'
import type { Asset, AssetListQuery, AssetPage, VideoCopy, VideoPreset } from '../types'

/**
 * `/api/assets*` (Nest, module `media-library`): the gallery pages (generated assets, newest first, cursor `before`),
 * the upload of files, the favorite toggle and the deletion.
 */
export const assetsApi = {
  list(query: AssetListQuery = {}): Promise<AssetPage> {
    const params = new URLSearchParams({ kind: 'generated', limit: String(query.limit ?? 60), media: query.media ?? 'image' })
    if (query.favorites) params.set('favorites', 'true')
    if (query.q) params.set('q', query.q)
    if (query.before) params.set('before', String(query.before))
    return studioRequest<AssetPage>('get', `/assets?${params.toString()}`)
  },
  /** Imports files (multipart field `files`); the answer lists the created `upload` assets. */
  upload(files: File[], options: StudioUploadOptions = {}): Promise<Asset[]> {
    const form = new FormData()
    for (const file of files) form.append('files', file)
    return studioUpload<Asset[]>('/assets', form, options)
  },
  setFavorite(id: string, favorite: boolean): Promise<Asset> {
    return studioRequest<Asset>('patch', `/assets/${encodeURIComponent(id)}`, { favorite })
  },
  /** A lighter MP4 of a video (`light` ≈ 360p, `tiny` ≈ 240p), made by the engine; `url` is served like an asset's. */
  exportVideo(id: string, preset: VideoPreset): Promise<VideoCopy> {
    return studioRequest<VideoCopy>('post', `/assets/${encodeURIComponent(id)}/export`, { preset })
  },
  remove(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/assets/${encodeURIComponent(id)}`)
  },
}
