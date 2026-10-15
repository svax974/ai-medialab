/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useQuery } from '@tanstack/react-query'
import { updatesKeys } from '../lib/updatesKeys'
import { updatesApi } from '../services/updatesApi'

/**
 * Looks for updates (reads Hugging Face and GitHub: seconds). Mounted only while the dialog is open and dropped from the cache
 * as soon as it closes (`gcTime: 0`), so the dialog never opens on an old answer; "check again" is `refetch()`.
 */
export function useUpdatesCheck() {
  return useQuery({ queryKey: updatesKeys.check, queryFn: () => updatesApi.check(), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false })
}
