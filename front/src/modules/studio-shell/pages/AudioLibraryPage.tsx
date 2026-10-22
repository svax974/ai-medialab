/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { AudioGallery } from '@/modules/audio-studio'

/** `/audio/bibliotheque`: every generated take (module `audio-studio`, built on the gallery of `media-library`). */
export function AudioLibraryPage() {
  return <AudioGallery />
}
