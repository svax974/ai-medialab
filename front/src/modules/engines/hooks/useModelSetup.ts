/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { type ModelInfo } from '@/modules/model-catalog'
import { LLAMACPP_INSTALL_TOPIC, PACK_INSTALL_TOPIC, parseInstallState, SDCPP_INSTALL_TOPIC, SETUP_TOPIC } from '../lib/installState'
import { enginesApi } from '../services/enginesApi'
import { useInstallStore } from '../state/installStore'
import { useSetupStore } from '../state/setupStore'
import type { EngineInstallState, PackInstallState, SetupRun } from '../types'

/**
 * Sets a model up: opens the confirmation dialog, which shows what will be downloaded (base data, engine, model) and, once
 * confirmed, runs the whole install in the engine with one progress and one cancel (`SetupDialog`).
 */
export function startSetup(model: Pick<ModelInfo, 'id'>): void {
  useSetupStore.getState().open(model.id)
}

/** Feeds the installers' live state from the event stream (`engine.pack.install`, `engine.engine.install`, `engine.llamacpp.install`). */
export function useInstallEvents(): void {
  useEffect(() => {
    const { setPackInstall, setEngineInstall, setLlamacppInstall, reset } = useInstallStore.getState()
    return eventStreamClient.subscribe(
      [PACK_INSTALL_TOPIC, SDCPP_INSTALL_TOPIC, LLAMACPP_INSTALL_TOPIC],
      (event) => {
        if (event.topic === PACK_INSTALL_TOPIC) {
          const state = parseInstallState<PackInstallState>(event.data)
          if (state) setPackInstall(state)
        } else {
          const state = parseInstallState<EngineInstallState>(event.data)
          if (!state) return
          if (event.topic === LLAMACPP_INSTALL_TOPIC) setLlamacppInstall(state)
          else setEngineInstall(state)
        }
      },
      { onResync: reset },
    )
  }, [])
}

/** Feeds the run of the model setup from the event stream, and reads it again after a reconnection or a page reload. */
export function useSetupEvents(): void {
  useEffect(() => {
    const refresh = () => void enginesApi.setupState().then((run) => useSetupStore.getState().setRun(run)).catch(() => undefined)
    refresh()
    return eventStreamClient.subscribe(
      [SETUP_TOPIC],
      (event) => {
        const run = parseInstallState<SetupRun>(event.data)
        if (run) useSetupStore.getState().setRun(run)
      },
      { onResync: refresh },
    )
  }, [])
}

/** Everything the studio shell mounts for the engines: live install state and the model setup run. */
export function useEnginesSync(): void {
  useInstallEvents()
  useSetupEvents()
}
