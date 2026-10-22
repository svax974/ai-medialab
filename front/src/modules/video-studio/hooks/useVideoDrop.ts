/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { useWindowDrop } from '@/modules_shared/common/components/ui/filedrop'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { classifyDrop } from '@/modules/media-library/lib/dropRules'
import { takeDropTarget } from '../lib/dropTarget'
import { useVideoInputs } from './useVideoInputs'

/**
 * Drop on the whole window while in video mode: images and videos go to the composer's slots (the one aimed at, else
 * automatically); the warning only shows when no file is an image or a video (`classifyDrop`, as before). Returns `dragging` for the veil.
 */
export function useVideoDrop(enabled: boolean): boolean {
  const { importFiles } = useVideoInputs()
  const { dragging } = useWindowDrop({
    multiple: true,
    enabled,
    onFiles: (files) => {
      const forced = takeDropTarget()
      const { accepted, warningKey } = classifyDrop('video', files)
      if (accepted.length > 0) void importFiles(accepted, forced)
      else if (warningKey) toast.warning(i18n.get(warningKey))
    },
  })
  return dragging
}
