/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { settingsApi } from '../services/settingsApi'
import { settingsKeys } from '../lib/settingsConfig'
import type { Settings, SettingsPatch } from '../types'

/** The settings; fetched only while `enabled` (the dialog is open). */
export function useSettings(enabled = true) {
  return useQuery({ queryKey: settingsKeys.settings, queryFn: () => settingsApi.get(), enabled })
}

/**
 * Saves a patch. The server answer (the whole public state) replaces the cache; the model catalogue is re-read
 * because quantization settings change what it shows. A refusal (engine 422/409) is shown as a message.
 */
export function useSaveSettings(onSaved?: (settings: Settings) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => settingsApi.save(patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.settings, settings)
      void queryClient.invalidateQueries({ queryKey: settingsKeys.models })
      onSaved?.(settings)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
