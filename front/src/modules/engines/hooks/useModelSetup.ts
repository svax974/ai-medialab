/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { toast } from 'react-toastify'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { modelCatalogApi, useDownloadStore, type ModelInfo } from '@/modules/model-catalog'
import { nextSetupStep, PACK_INSTALL_TOPIC, parseInstallState, relevantInstall, SDCPP_INSTALL_TOPIC } from '../lib/installState'
import { enginesApi } from '../services/enginesApi'
import { useInstallStore } from '../state/installStore'
import type { EngineInstallState, PackInstallState } from '../types'

/**
 * Installs what a model needs: the engine first when it is missing (the model is then downloaded by
 * `useSetupController` once the engine is installed), else just the model. Errors are shown as messages.
 */
export async function startSetup(model: ModelInfo): Promise<void> {
  const store = useInstallStore.getState()
  try {
    if (model.needs_engine_install) {
      // A finished previous install must not look like this one is done: reset before the pending model is set.
      if (model.engine_pack) store.setPackInstall({ state: 'idle' })
      else store.setEngineInstall({ state: 'idle' })
      store.setPending(model.install === 'installed' ? null : model.id)
      if (model.engine_pack) store.setPackInstall(await enginesApi.installPack(model.engine_pack))
      else store.setEngineInstall(await enginesApi.installSdcpp())
    } else if (model.install !== 'installed') {
      useDownloadStore.getState().setDownload(await modelCatalogApi.download(model.id))
    }
  } catch (error) {
    store.setPending(null)
    toast.error((error as Error).message)
  }
}

/** Feeds the installers' live state from the event stream (`engine.pack.install`, `engine.engine.install`). */
export function useInstallEvents(): void {
  useEffect(() => {
    const { setPackInstall, setEngineInstall, reset } = useInstallStore.getState()
    return eventStreamClient.subscribe(
      [PACK_INSTALL_TOPIC, SDCPP_INSTALL_TOPIC],
      (event) => {
        if (event.topic === PACK_INSTALL_TOPIC) {
          const state = parseInstallState<PackInstallState>(event.data)
          if (state) setPackInstall(state)
        } else {
          const state = parseInstallState<EngineInstallState>(event.data)
          if (state) setEngineInstall(state)
        }
      },
      { onResync: reset },
    )
  }, [])
}

/**
 * When the engine of a pending model is installed, starts downloading the model (read from the catalogue, which
 * the finished install has just changed); gives up when the install failed or was cancelled.
 */
export function useSetupController(): void {
  const sd = useInstallStore((s) => s.engineInstall)
  const pack = useInstallStore((s) => s.packInstall)
  const pending = useInstallStore((s) => s.pendingModelId)
  const engineState = relevantInstall(sd, pack).state
  useEffect(() => {
    const step = nextSetupStep(pending, engineState)
    if (step === 'wait' || !pending) return
    useInstallStore.getState().setPending(null)
    if (step === 'abort') return
    void (async () => {
      try {
        // Direct call: a query on the same key would be cancelled by the invalidation the install triggers.
        const catalog = await modelCatalogApi.catalog()
        const model = catalog.models.find((m) => m.id === pending)
        if (model && model.install !== 'installed') useDownloadStore.getState().setDownload(await modelCatalogApi.download(pending))
      } catch (error) {
        toast.error((error as Error).message)
      }
    })()
  }, [engineState, pending])
}

/** Everything the studio shell mounts for the engines: live install state and the two-step setup. */
export function useEnginesSync(): void {
  useInstallEvents()
  useSetupController()
}
