/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { hardwareKeys } from '@/modules/hardware'
import { resolveActiveModel, welcomeModel } from '../lib/activeModel'
import { modelCatalogKeys } from '../lib/modelCatalogKeys'
import { modelCatalogApi } from '../services/modelCatalogApi'
import { useModelUsage } from './useModelUsage'
import { useDownloadStore } from '../state/downloadStore'
import { useModelSelectionStore } from '../state/modelSelectionStore'
import type { ModelInfo, ModelKind } from '../types'

/** The model catalogue (installed state, memory fit, engines). Kept fresh by the `models.changed` and download events. */
export function useModels(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: modelCatalogKeys.models, queryFn: () => modelCatalogApi.catalog(), enabled: options.enabled ?? true, staleTime: 10_000 })
}

/** The model a composer uses for a kind (see `resolveActiveModel`); undefined while the catalogue loads. */
export function useActiveModel(kind: ModelKind = 'image'): ModelInfo | undefined {
  const { data } = useModels()
  const stored = useModelSelectionStore((s) => s.selected[kind] ?? null) // a state saved before `llm` existed lacks it
  const usage = useModelUsage()
  return data ? resolveActiveModel(data, kind, stored, usage) : undefined
}

/** The model the welcome card proposes: while nothing is ready, the one recommended for this machine. */
export function useWelcomeModel(kind: ModelKind = 'image'): ModelInfo | null {
  const { data } = useModels()
  const active = useActiveModel(kind)
  return data ? welcomeModel(data, kind, active) : null
}

/** Refreshes what a download, a deletion or an addition changes: the catalogue and the machine (free disk). */
export function useRefreshCatalog(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: modelCatalogKeys.models }),
      queryClient.invalidateQueries({ queryKey: hardwareKeys.system }),
    ])
  }
}

const showError = (error: Error) => void toast.error(error.message)

/** Starts a download; the progress comes back through the event stream. */
export function useStartDownload() {
  const setDownload = useDownloadStore((s) => s.setDownload)
  return useMutation({ mutationFn: (modelId: string) => modelCatalogApi.download(modelId), onSuccess: setDownload, onError: showError })
}

export function useCancelDownload() {
  return useMutation({ mutationFn: (modelId: string) => modelCatalogApi.cancelDownload(modelId), onError: showError })
}
