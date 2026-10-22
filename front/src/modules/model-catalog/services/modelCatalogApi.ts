/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { DownloadProgress, HubInspect, HubResult, HubTrending, ModelCatalog, ModelKind, TrendingKind } from '../types'

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
  /** Deletes the full-precision source once a locally quantized variant is installed from it. */
  freeBf16Source(modelId: string): Promise<{ freed_gb: number }> {
    return studioRequest<{ freed_gb: number }>('delete', `/models/${encodeURIComponent(modelId)}/source/bf16`)
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
  /** New, successful models of a kind this machine can run; `refresh` asks the engine to read the Hub again (it keeps an hour). */
  hubTrending(kind: TrendingKind, options: { days: number; includeHeavy?: boolean; refresh?: boolean }): Promise<HubTrending> {
    const query = new URLSearchParams({ kind, days: String(options.days), include_heavy: String(!!options.includeHeavy), refresh: String(!!options.refresh) })
    return studioRequest<HubTrending>('get', `/hf/trending?${query.toString()}`)
  },
  hubInspect(repo: string): Promise<HubInspect> {
    return studioRequest<HubInspect>('get', `/hf/inspect?repo=${encodeURIComponent(repo)}`)
  },
}
