/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { VideoGallery } from '@/modules/video-studio'

/** `/video/bibliotheque`: every generated clip (module `video-studio`, built on the gallery of `media-library`). */
export function VideoLibraryPage() {
  return <VideoGallery />
}
