/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export { EnginesPanel } from './components/EnginesPanel'
export { EnginesCard } from './components/EnginesCard'
export { LlamacppCard } from './components/LlamacppCard'
export { PacksCard } from './components/PacksCard'
export { LocalAiProgress } from './components/LocalAiProgress'
export { LocalAiLaunchDialog, type LaunchExtraOption } from './components/LocalAiLaunchDialog'
export { shouldPromptLocalAi } from './lib/launchPrompt'
export { useLocalAiPromptStore } from './state/localAiPromptStore'
export { SetupPrompt, WelcomeSetup } from './components/SetupPrompt'
export { SetupDialog } from './components/SetupDialog'
export { ComponentsManager } from './components/ComponentsManager'
export { useLocalAiSetup, type LocalAiSetup } from './hooks/useLocalAiSetup'
export { ADVISOR_MODEL_ID, DISK_MARGIN_GB, deriveLocalAi, pickAdvisor, type LocalAiProgress as LocalAiProgressInfo, type LocalAiState, type LocalAiView } from './lib/localAi'
export { startSetup, useEnginesSync, useInstallEvents, useSetupEvents } from './hooks/useModelSetup'
export { useCancelInstall, useInstallLlamacpp, useInstallPack, useInstallSdcpp } from './hooks/useEngineInstaller'
export { LLAMACPP_INSTALL_TOPIC, PACK_INSTALL_TOPIC, SDCPP_INSTALL_TOPIC, SETUP_TOPIC } from './lib/installState'
export { enginesApi } from './services/enginesApi'
export { useInstallStore } from './state/installStore'
export { useSetupStore } from './state/setupStore'
export type { ComponentInfo, EngineInfo, EngineInstallState, InstallPlan, InstallStatus, PackInfo, PackInstallState, SetupRun } from './types'
