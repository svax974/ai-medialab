/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useWriteWithVoice } from '@/modules/audio-studio'
import { VoicesLibrary } from '@/modules/voices'

/** `/audio/voix`: the voice library (module `voices`); "write with this voice" is the audio studio's. */
export function VoicesPage() {
  return <VoicesLibrary onUse={useWriteWithVoice()} />
}
