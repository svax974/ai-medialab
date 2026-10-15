/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { modelCatalogKeys } from '../lib/modelCatalogKeys'
import { modelCatalogApi } from '../services/modelCatalogApi'
import type { HubTrending, TrendingKind } from '../types'

/** The engine keeps its answer for an hour: a shorter memory here would only ask it the same thing again. */
const STALE_MS = 30 * 60_000

interface Options {
  days: number
  includeHeavy?: boolean
  enabled?: boolean
}

/** New, successful models of a kind that this machine can run (engine: `hf_trending.py`). */
export function useWhatsNew(kind: TrendingKind, { days, includeHeavy = false, enabled = true }: Options) {
  return useQuery({
    queryKey: modelCatalogKeys.trending(kind, days, includeHeavy),
    queryFn: () => modelCatalogApi.hubTrending(kind, { days, includeHeavy }),
    enabled,
    staleTime: STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** Asks the engine to read the Hub again (it ignores the request when its answer is under a minute old). */
export function useRefreshWhatsNew(kind: TrendingKind, { days, includeHeavy = false }: Pick<Options, 'days' | 'includeHeavy'>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => modelCatalogApi.hubTrending(kind, { days, includeHeavy, refresh: true }),
    onSuccess: (data: HubTrending) => queryClient.setQueryData(modelCatalogKeys.trending(kind, days, includeHeavy), data),
  })
}
