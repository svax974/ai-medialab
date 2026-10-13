/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { hardwareKeys } from '@/modules/hardware'
import { modelCatalogKeys } from '@/modules/model-catalog'
import { enginesApi } from '../services/enginesApi'
import { useInstallStore } from '../state/installStore'

const showError = (error: Error) => void toast.error(error.message)

/** Installs a pack (isolated Python environment): the state comes back at once, then through the event stream. */
export function useInstallPack() {
  const setPackInstall = useInstallStore((s) => s.setPackInstall)
  return useMutation({ mutationFn: (packId: string) => enginesApi.installPack(packId), onSuccess: setPackInstall, onError: showError })
}

export function useInstallSdcpp() {
  const setEngineInstall = useInstallStore((s) => s.setEngineInstall)
  return useMutation({ mutationFn: () => enginesApi.installSdcpp(), onSuccess: setEngineInstall, onError: showError })
}

/** Cancels the running installation (nothing to say when none is running any more: the engine answers 409). */
export function useCancelInstall(kind: 'pack' | 'sdcpp') {
  return useMutation({ mutationFn: () => (kind === 'pack' ? enginesApi.cancelPackInstall() : enginesApi.cancelSdcppInstall()) })
}

/**
 * Uninstalls a pack after confirmation. The engine answers once the environment is deleted (it frees the disk), the
 * downloaded models stay. `removing` is the pack being removed, to show progress on its row.
 */
export function useUninstallPack(): { removing: string | null; uninstall: (packId: string, name: string) => Promise<void> } {
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<string | null>(null)
  const uninstall = async (packId: string, name: string) => {
    const ok = await confirm({ titleId: 'engines.uninstall.title', messageId: 'engines.uninstall.message', params: [name], confirmLabelId: 'engines.uninstall.confirm', danger: true })
    if (!ok) return
    setRemoving(packId)
    try {
      await enginesApi.uninstallPack(packId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: modelCatalogKeys.models }),
        queryClient.invalidateQueries({ queryKey: hardwareKeys.system }),
      ])
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRemoving(null)
    }
  }
  return { removing, uninstall }
}

