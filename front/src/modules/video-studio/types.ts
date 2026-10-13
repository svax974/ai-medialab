/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Where an attached file goes in the video composer: the first frame, the last frame, or the video to edit. */
export type VideoSlot = 'start' | 'end' | 'source'

/** An import in progress: a slot shows its progress until the server has the file. `progress` is 0..1. */
export interface VideoUpload {
  id: string
  slot: VideoSlot
  name: string
  progress: number
}
