/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { assetsApi } from '@/modules/media-library/services/assetsApi'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import type { Asset } from '../types'
import { applyStudioOp } from './useStudioEvents'

/** Favorite toggle: the answer replaces the asset everywhere it is shown (conversations, lists, viewer). */
export function useToggleFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (asset: Pick<Asset, 'id' | 'favorite'>) => assetsApi.setFavorite(asset.id, !asset.favorite),
    onSuccess: (asset) => void applyStudioOp(queryClient, { type: 'asset', asset }),
    onError: (error: Error) => void toast.error(error.message),
  })
}

/** Deletes an image from the viewer (after confirming); the viewer drops it and closes when it was the last one. */
export function useDeleteAsset() {
  const drop = useLightboxStore((s) => s.drop)
  const remove = useMutation({
    mutationFn: (id: string) => assetsApi.remove(id),
    onSuccess: (_result, id) => drop(id),
    onError: (error: Error) => void toast.error(error.message),
  })
  return async (asset: Pick<Asset, 'id' | 'media'>): Promise<void> => {
    const ok = await confirm({
      titleId: asset.media === 'video' ? 'thread.viewer.delete.title.video' : 'thread.viewer.delete.title.image',
      confirmLabelId: 'thread.delete',
      danger: true,
    })
    if (ok) remove.mutate(asset.id)
  }
}
