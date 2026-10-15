/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useQuery } from '@tanstack/react-query'
import { updatesKeys } from '../lib/updatesKeys'
import { updatesApi } from '../services/updatesApi'

/**
 * The stored advice, newest first. They come from the local database (no network), so the dialog shows them at once, while the check
 * is still reading Hugging Face and GitHub or when it fails (offline).
 */
export function useAdvisories() {
  return useQuery({ queryKey: updatesKeys.advisories, queryFn: () => updatesApi.advisories(), staleTime: 0, retry: false, refetchOnWindowFocus: false })
}
