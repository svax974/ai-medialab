/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { DownloadProgress, HubInspect, HubResult, ModelCatalog, ModelKind } from '../types'

/** Nest routes `/api/models*` and `/api/hf/*` (they delegate to the Python engine). */
export const modelCatalogApi = {
  catalog(): Promise<ModelCatalog> {
    return studioRequest<ModelCatalog>('get', '/models')
  },
  /** Finished generations per model id (the library's own history). */
  usage(): Promise<{ counts: Record<string, number> }> {
    return studioRequest<{ counts: Record<string, number> }>('get', '/messages/model-usage')
  },
  download(modelId: string): Promise<DownloadProgress> {
    return studioRequest<DownloadProgress>('post', `/models/${encodeURIComponent(modelId)}/download`)
  },
  cancelDownload(modelId: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/models/${encodeURIComponent(modelId)}/download`)
  },
  deleteModel(modelId: string): Promise<{ freed_gb: number; also_affects: string[] }> {
    return studioRequest<{ freed_gb: number; also_affects: string[] }>('delete', `/models/${encodeURIComponent(modelId)}`)
  },
  addCustom(repo: string, option: string): Promise<{ model_id: string }> {
    return studioRequest<{ model_id: string }>('post', '/models/custom', { repo, option })
  },
  removeCustom(modelId: string): Promise<{ freed_gb: number }> {
    return studioRequest<{ freed_gb: number }>('delete', `/models/${encodeURIComponent(modelId)}/custom`)
  },
  async hubSearch(kind: ModelKind, query: string): Promise<HubResult[]> {
    const { results } = await studioRequest<{ results: HubResult[] }>('get', `/hf/search?kind=${kind}&q=${encodeURIComponent(query)}`)
    return results
  },
  hubInspect(repo: string): Promise<HubInspect> {
    return studioRequest<HubInspect>('get', `/hf/inspect?repo=${encodeURIComponent(repo)}`)
  },
}
