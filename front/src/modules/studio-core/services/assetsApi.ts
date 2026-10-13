/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioRequest, studioUpload, type StudioUploadOptions } from '@/modules/studio-shell/services/studioHttp'
import type { Asset, AssetMedia, AssetPage } from '../types'

export interface AssetListQuery {
  media?: AssetMedia
  favorites?: boolean
  q?: string
  before?: number | null
  limit?: number
}

/**
 * `/api/assets*` (Nest, module `media-library`). H4.3 needs the upload of references, the favorite toggle, the deletion
 * from the viewer and the recent images of the home page; the gallery (H4.4) extends this file's callers.
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
  remove(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/assets/${encodeURIComponent(id)}`)
  },
}
