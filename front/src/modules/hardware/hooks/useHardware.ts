/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { hardwareApi } from '../services/hardwareApi'
import { hardwareKeys } from '../lib/hardwareKeys'

/** Machine description. `pollMs` refreshes the free memory and disk while a panel showing them is open. */
export function useSystemInfo(options: { enabled?: boolean; pollMs?: number | false } = {}) {
  return useQuery({
    queryKey: hardwareKeys.system,
    queryFn: () => hardwareApi.system(),
    enabled: options.enabled ?? true,
    staleTime: 5_000,
    refetchInterval: options.pollMs ?? false,
  })
}

/** State of the generation worker (loaded model, queue). Refreshed by the `engine.status` event. */
export function useEngineStatus(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: hardwareKeys.status, queryFn: () => hardwareApi.status(), enabled: options.enabled ?? true })
}

/** Unloads the loaded model (409 while a generation runs: the message is shown). */
export function useUnloadEngine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => hardwareApi.unload(),
    onSuccess: (status) => queryClient.setQueryData(hardwareKeys.status, status),
    onError: (error: Error) => toast.error(error.message),
  })
}
