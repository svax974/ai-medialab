/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { DownloadProgress } from '@/modules/model-catalog'
import type { EngineInstallState, PackInstallState } from '@/modules/engines'
import type { AdviseBody, UpdateAdvisory, UpdateTarget, UpdatesReport } from '../types'

/** Nest routes `/api/updates/*` (they delegate to the Python engine, which reports progress through events). */
export const updatesApi = {
  check(): Promise<UpdatesReport> {
    return studioRequest<UpdatesReport>('get', '/updates/check')
  },
  /** Every stored advice, newest first: read from the local database, so it works without a network. */
  advisories(): Promise<UpdateAdvisory[]> {
    return studioRequest<UpdateAdvisory[]>('get', '/updates/advisories')
  },
  /** Has the local model read the public sources about an update and list the problems (about a minute); the answer is stored. */
  advise(body: AdviseBody): Promise<UpdateAdvisory> {
    return studioRequest<UpdateAdvisory>('post', '/updates/advise', body)
  },
  removeAdvisory(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/updates/advisories/${encodeURIComponent(id)}`)
  },
  updateModel(modelId: string): Promise<DownloadProgress> {
    return studioRequest<DownloadProgress>('post', `/updates/models/${encodeURIComponent(modelId)}`)
  },
  /** `sdcpp` answers the stable-diffusion.cpp install state, any other engine (audio.cpp, a pack) the pack install state. */
  updateEngine(engineId: string, target: UpdateTarget = 'pinned'): Promise<EngineInstallState | PackInstallState> {
    return studioRequest<EngineInstallState | PackInstallState>('post', `/updates/engines/${encodeURIComponent(engineId)}`, { target })
  },
}
