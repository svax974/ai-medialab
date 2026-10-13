/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export { EnginesPanel } from './components/EnginesPanel'
export { EnginesCard } from './components/EnginesCard'
export { PacksCard } from './components/PacksCard'
export { SetupPrompt, WelcomeSetup } from './components/SetupPrompt'
export { startSetup, useEnginesSync, useInstallEvents, useSetupController } from './hooks/useModelSetup'
export { useCancelInstall, useInstallPack, useInstallSdcpp, useUninstallPack } from './hooks/useEngineInstaller'
export { PACK_INSTALL_TOPIC, SDCPP_INSTALL_TOPIC } from './lib/installState'
export { enginesApi } from './services/enginesApi'
export { useInstallStore } from './state/installStore'
export type { EngineInfo, EngineInstallState, InstallStatus, PackInfo, PackInstallState } from './types'
