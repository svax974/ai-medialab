/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { DropVeil } from '@/modules/media-library'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVideoDrop } from '../hooks/useVideoDrop'

/** Veil shown while images or videos are dragged over the window (mounted once by the shell in video mode); the drop itself is `useVideoDrop`. */
export function VideoDropLayer() {
  const t = useT()
  const dragging = useVideoDrop(true)
  return dragging ? <DropVeil title={t('library.drop.video.title')} body={t('library.drop.video.body')} /> : null
}
