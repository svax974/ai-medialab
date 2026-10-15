/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { modelCatalogKeys } from '../lib/modelCatalogKeys'
import { SEARCH_DEBOUNCE_MS } from '../lib/hubSearch'
import { modelCatalogApi } from '../services/modelCatalogApi'
import { useDownloadStore } from '../state/downloadStore'
import type { ModelKind } from '../types'
import { useRefreshCatalog } from './useModelCatalog'

/** The text typed in the search box and its debounced value (what is actually searched). */
export function useDebouncedQuery(): { text: string; setText: (text: string) => void; query: string } {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])
  return { text, setText, query }
}

/**
 * Hugging Face search, limited to formats the app can run (the engine filters). Results stay in memory for a minute
 * (same kind and query: no new request), and the engine keeps its own copy: see `docs/components/`.
 */
export function useHubSearch(kind: ModelKind, query: string) {
  return useQuery({ queryKey: modelCatalogKeys.hub(kind, query), queryFn: () => modelCatalogApi.hubSearch(kind, query), staleTime: 60_000, retry: false })
}

/** Reads one repository: licence, notes, quantizations with their memory fit. Five minutes in memory. */
export function useHubInspect(repo: string) {
  return useQuery({ queryKey: modelCatalogKeys.hubInspect(repo), queryFn: () => modelCatalogApi.hubInspect(repo), staleTime: 300_000, retry: false })
}

/** Adds a repository to the list, then starts downloading it (the progress comes through the event stream); answers the id of the new model. */
export function useAddCustomModel(repo: string) {
  const refresh = useRefreshCatalog()
  const setDownload = useDownloadStore((s) => s.setDownload)
  return useMutation({
    mutationFn: async (option: string): Promise<string> => {
      const { model_id } = await modelCatalogApi.addCustom(repo, option)
      await refresh()
      try {
        setDownload(await modelCatalogApi.download(model_id))
      } catch (error) {
        toast.error((error as Error).message)
      }
      return model_id
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
