/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { VideoSlot } from '../types'

let target: VideoSlot | undefined

/** A slot a file is being dragged over tells the window-level drop which slot was aimed at. */
export function setDropTarget(slot: VideoSlot | undefined): void {
  target = slot
}

/** The slot aimed at by the drop that just happened (read once: it is forgotten). */
export function takeDropTarget(): VideoSlot | undefined {
  const slot = target
  target = undefined
  return slot
}
