/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { useWindowDrop } from '@/modules_shared/common/components/ui/filedrop'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { classifyDrop } from '@/modules/media-library/lib/dropRules'
import { useVoiceStudioStore } from '../state/voiceStudioStore'

/**
 * Drop on the whole window while in audio mode: the first sound file opens the voice studio on it (a voice sample).
 * Everything is received and sorted by `classifyDrop` (as before): the warning only shows when no file is a sound.
 * Returns `dragging` for the veil.
 */
export function useVoiceDrop(enabled: boolean): boolean {
  const { dragging } = useWindowDrop({
    multiple: true,
    enabled,
    onFiles: (files) => {
      const { accepted, warningKey } = classifyDrop('audio', files)
      if (accepted[0]) useVoiceStudioStore.getState().open({ file: accepted[0] })
      else if (warningKey) toast.warning(i18n.get(warningKey))
    },
  })
  return dragging
}
