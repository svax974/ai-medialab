/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { DropVeil } from '@/modules/media-library/components/DropVeil'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVoiceDrop } from '../hooks/useVoiceDrop'

/** Veil shown while a sound is dragged over the window (mounted by the shell in audio mode); the drop is `useVoiceDrop`. */
export function VoiceDropLayer() {
  const t = useT()
  const dragging = useVoiceDrop(true)
  return dragging ? <DropVeil title={t('library.drop.audio.title')} body={t('library.drop.audio.body')} /> : null
}
