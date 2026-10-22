/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { useWindowDrop } from '@/modules_shared/common/components/ui/filedrop'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { addAsReference, dragHasAsset, parseDraggedAsset, ASSET_DRAG_TYPE } from '@/modules/studio-core'
import { IMAGE_ACCEPT, uploadReferences } from '../lib/uploadReferences'

/** An image of the conversation dragged over the window (not a file): same behavior as before, it becomes a reference. */
function useAssetDrop(enabled: boolean): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!dragHasAsset(Array.from(event.dataTransfer?.types ?? []))) return
      event.preventDefault()
      depth += 1
      setDragging(true)
    }
    const over = (event: DragEvent) => dragHasAsset(Array.from(event.dataTransfer?.types ?? [])) && event.preventDefault()
    const leave = (event: DragEvent) => {
      if (!dragHasAsset(Array.from(event.dataTransfer?.types ?? []))) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!dragHasAsset(Array.from(event.dataTransfer?.types ?? []))) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const asset = parseDraggedAsset(event.dataTransfer?.getData(ASSET_DRAG_TYPE) ?? '')
      if (asset) addAsReference(asset)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [enabled])
  return dragging
}

/**
 * Drop on the whole window while in image mode: files are imported as references (`useWindowDrop` of `common`, images
 * only, others ignored with a warning) and so are the conversation's own images dragged out of a tile.
 * Returns `dragging` for the overlay.
 */
export function useImageDrop(enabled: boolean): boolean {
  const files = useWindowDrop({
    accept: IMAGE_ACCEPT,
    multiple: true,
    enabled,
    onFiles: (accepted) => void uploadReferences(accepted),
    onRejected: () => void toast.warning(i18n.get('imageStudio.upload.ignored')),
  })
  const asset = useAssetDrop(enabled)
  return files.dragging || asset
}
