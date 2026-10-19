/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
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

export function useInstallLlamacpp() {
  const setLlamacppInstall = useInstallStore((s) => s.setLlamacppInstall)
  return useMutation({ mutationFn: () => enginesApi.installLlamacpp(), onSuccess: setLlamacppInstall, onError: showError })
}

/** Cancels the running installation (nothing to say when none is running any more: the engine answers 409). */
export function useCancelInstall(kind: 'pack' | 'sdcpp' | 'llamacpp') {
  const cancel = { pack: enginesApi.cancelPackInstall, sdcpp: enginesApi.cancelSdcppInstall, llamacpp: enginesApi.cancelLlamacppInstall }[kind]
  return useMutation({ mutationFn: () => cancel() })
}
