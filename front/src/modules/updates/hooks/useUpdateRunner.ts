/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useInstallStore } from '@/modules/engines'
import { useDownloadStore } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { decideNext } from '../lib/queue'
import { updatesKeys } from '../lib/updatesKeys'
import { outcomeOf } from '../lib/updateItems'
import { updatesApi } from '../services/updatesApi'
import { useUpdatesStore } from '../state/updatesStore'
import type { UpdateItem } from '../types'

/** Starts an update and hands the answer to the store the installer's events keep up to date (it replaces an older run's state). */
async function startUpdate(item: UpdateItem): Promise<void> {
  if (item.kind === 'model') {
    useDownloadStore.getState().setDownload(await updatesApi.updateModel(item.id))
    return
  }
  const state = await updatesApi.updateEngine(item.id, item.target)
  if (item.id === 'sdcpp') useInstallStore.getState().setEngineInstall(state)
  else useInstallStore.getState().setPackInstall(state)
}

/**
 * Runs the queued updates one after the other and follows each through the installer's events (no polling). Mounted once
 * by the studio shell, so the updates go on when the dialog is closed. A refused start (up to date, engine in use, another
 * installation running) fails that item with the engine's message; the others go on. When the queue is done the check is dropped, so the
 * dialog shows the new state the next time it opens.
 */
export function useUpdateRunner(): void {
  const t = useT()
  const queryClient = useQueryClient()
  const queue = useUpdatesStore((s) => s.queue)
  const downloads = useDownloadStore((s) => s.downloads)
  const engineInstall = useInstallStore((s) => s.engineInstall)
  const packInstall = useInstallStore((s) => s.packInstall)
  const started = useRef(new Set<string>())
  const starting = useRef(false)
  const wasActive = useRef(false)

  useEffect(() => {
    const { setStatus } = useUpdatesStore.getState()
    const action = decideNext(queue, (item) => outcomeOf(item, { downloads, engineInstall, packInstall }, t('updates.cancelled')), started.current, starting.current, wasActive.current)
    if (action.type === 'finish') {
      started.current.delete(action.key)
      setStatus(action.key, action.status, action.error)
    } else if (action.type === 'start') {
      const { item } = action
      wasActive.current = true
      starting.current = true
      setStatus(item.key, 'running')
      startUpdate(item)
        .then(() => started.current.add(item.key))
        .catch((error: Error) => setStatus(item.key, 'error', error.message))
        .finally(() => {
          starting.current = false
          useUpdatesStore.setState((s) => ({ queue: [...s.queue] })) // run the effect again: read the outcome, start the next one, or finish
        })
    } else if (action.type === 'refresh') {
      wasActive.current = false
      void queryClient.invalidateQueries({ queryKey: updatesKeys.check })
    }
  }, [queue, downloads, engineInstall, packInstall, queryClient, t])
}
