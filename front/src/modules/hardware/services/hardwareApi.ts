/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { EngineStatus, SystemInfo } from '../types'

/** Nest routes `/api/system`, `/api/status`, `/api/engine/unload` (they delegate to the Python engine). */
export const hardwareApi = {
  system(refresh = false): Promise<SystemInfo> {
    return studioRequest<SystemInfo>('get', refresh ? '/system?refresh=true' : '/system')
  },
  status(): Promise<EngineStatus> {
    return studioRequest<EngineStatus>('get', '/status')
  },
  unload(): Promise<EngineStatus> {
    return studioRequest<EngineStatus>('post', '/engine/unload')
  },
}
