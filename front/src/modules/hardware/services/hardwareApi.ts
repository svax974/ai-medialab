/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { EmergencyStopResult, EngineStatus, MemoryLive, SystemInfo } from '../types'

/** Nest routes `/api/system`, `/api/memory`, `/api/status`, `/api/engine/unload`, `/api/engine/emergency-stop` (they delegate to the Python engine). */
export const hardwareApi = {
  system(refresh = false): Promise<SystemInfo> {
    return studioRequest<SystemInfo>('get', refresh ? '/system?refresh=true' : '/system')
  },
  status(): Promise<EngineStatus> {
    return studioRequest<EngineStatus>('get', '/status')
  },
  memory(): Promise<MemoryLive> {
    return studioRequest<MemoryLive>('get', '/memory')
  },
  /** The red button: kills the models in memory and cancels what waits. */
  emergencyStop(): Promise<EmergencyStopResult> {
    return studioRequest<EmergencyStopResult>('post', '/engine/emergency-stop')
  },
  unload(): Promise<EngineStatus> {
    return studioRequest<EngineStatus>('post', '/engine/unload')
  },
}
