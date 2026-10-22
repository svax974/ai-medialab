/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { DropVeil } from '@/modules/media-library/components/DropVeil'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useImageDrop } from '../hooks/useImageDrop'

/** Veil shown while images are dragged over the window (mounted once by the shell in image mode); the drop itself is `useImageDrop`. */
export function ImageDropLayer() {
  const t = useT()
  const dragging = useImageDrop(true)
  return dragging ? <DropVeil title={t('imageStudio.drop.title')} body={t('imageStudio.drop.body')} /> : null
}
