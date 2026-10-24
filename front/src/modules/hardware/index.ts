/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export { MachineCard, MachineSummary, StoragePaths } from './components/MachineCard'
export { useSystemInfo, useEngineStatus, useUnloadEngine } from './hooks/useHardware'
export { hardwareKeys } from './lib/hardwareKeys'
export { formatGb } from './lib/machine'
export { hardwareApi } from './services/hardwareApi'
export type {
  Accelerator,
  EngineInfo,
  EngineInstallState,
  EngineStatus,
  InstallStatus,
  MemoryBudget,
  PackInfo,
  PackInstallState,
  SystemInfo,
  UnusableGpu,
} from './types'
