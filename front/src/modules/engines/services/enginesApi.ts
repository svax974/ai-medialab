/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { ComponentInfo, DependantModel, EngineInstallState, InstallPlan, PackInstallState, SetupRun } from '../types'

/** Nest routes `/api/engines/*` (they delegate to the Python engine, which installs and reports through events). */
export const enginesApi = {
  installPack(packId: string): Promise<PackInstallState> {
    return studioRequest<PackInstallState>('post', `/engines/pack/${encodeURIComponent(packId)}/install`)
  },
  cancelPackInstall(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', '/engines/pack/install')
  },
  uninstallPack(packId: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/engines/pack/${encodeURIComponent(packId)}`)
  },
  installSdcpp(): Promise<EngineInstallState> {
    return studioRequest<EngineInstallState>('post', '/engines/sdcpp/install')
  },
  cancelSdcppInstall(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', '/engines/sdcpp/install')
  },
  installLlamacpp(): Promise<EngineInstallState> {
    return studioRequest<EngineInstallState>('post', '/engines/llamacpp/install')
  },
  cancelLlamacppInstall(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', '/engines/llamacpp/install')
  },
  uninstallLlamacpp(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', '/engines/llamacpp')
  },
  components(disk = false): Promise<ComponentInfo[]> {
    return studioRequest<ComponentInfo[]>('get', `/engines/components?disk=${disk}`)
  },
  removeComponent(componentId: string): Promise<{ ok: true; removed_models: DependantModel[] }> {
    return studioRequest<{ ok: true; removed_models: DependantModel[] }>('delete', `/engines/components/${encodeURIComponent(componentId)}`)
  },
  installPlan(modelId: string): Promise<InstallPlan> {
    return studioRequest<InstallPlan>('get', `/engines/setup/plan/${encodeURIComponent(modelId)}`)
  },
  setupState(): Promise<SetupRun> {
    return studioRequest<SetupRun>('get', '/engines/setup')
  },
  startSetup(modelId: string): Promise<SetupRun> {
    return studioRequest<SetupRun>('post', `/engines/setup/${encodeURIComponent(modelId)}`)
  },
  cancelSetup(): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', '/engines/setup')
  },
}
