/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react'
import { toast } from 'react-toastify'
import { useSystemInfo } from '@/modules/hardware'
import { modelCatalogApi, useDownloadStore, useModels } from '@/modules/model-catalog'
import { deriveLocalAi, pickAdvisor, type LocalAiView } from '../lib/localAi'
import { enginesApi } from '../services/enginesApi'
import { useInstallStore } from '../state/installStore'
import { startSetup } from './useModelSetup'

export interface LocalAiSetup extends LocalAiView {
  /**
   * Installs what is missing: llama.cpp, then (`withModel`, the default) the recommended chat model, each through the installers
   * that already exist (progress comes back through `progress`). Does nothing when it is already installed, under way, or when the
   * disk is too small (`state: 'no-space'`: tell the user, nothing is started).
   */
  start: (options?: { withModel?: boolean }) => Promise<void>
  /** Stops the running step (engine install or model download) and the model download that was to follow it. */
  cancel: () => Promise<void>
}

/**
 * The local AI setup (llama.cpp + a small chat model) as one reusable flow: what is missing, how big it is, whether the disk can hold
 * it, the progress, errors, start and cancel. Used by the update adviser's invite and by any screen that needs a local model.
 * Mounted anywhere under the studio shell (it relies on `useEnginesSync`, which mounts once there and downloads the model after the engine).
 */
export function useLocalAiSetup(): LocalAiSetup {
  const catalog = useModels().data
  const system = useSystemInfo().data
  const downloads = useDownloadStore((s) => s.downloads)
  const engineInstall = useInstallStore((s) => s.llamacppInstall)
  const pendingModelId = useInstallStore((s) => s.pendingModelId)
  const info = system?.engines['llamacpp']
  const view = deriveLocalAi({
    models: catalog?.models, recommendedId: catalog?.llm?.recommended_model_id, engineInstalled: info ? info.available : undefined,
    engineSizeMb: info?.install_size_mb, engineInstall, downloads, pendingModelId, freeDiskGb: system ? system.disk.free_gb : null,
  })
  const advisor = catalog ? pickAdvisor(catalog.models, catalog.llm?.recommended_model_id) : null

  const start = useCallback(async ({ withModel = true }: { withModel?: boolean } = {}) => {
    if (!['needs-setup', 'error'].includes(view.state) || !advisor) return
    if (withModel && !view.modelInstalled) return startSetup(advisor)
    if (view.engineInstalled) return
    try {
      useInstallStore.getState().setLlamacppInstall(await enginesApi.installLlamacpp())
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [view.state, view.modelInstalled, view.engineInstalled, advisor])

  const cancel = useCallback(async () => {
    useInstallStore.getState().setPending(null)
    try {
      if (view.progress?.step === 'engine') await enginesApi.cancelLlamacppInstall()
      else if (advisor) await modelCatalogApi.cancelDownload(advisor.id)
    } catch {
      // nothing is running any more: the installer answers 409
    }
  }, [view.progress?.step, advisor])

  return { ...view, start, cancel }
}
