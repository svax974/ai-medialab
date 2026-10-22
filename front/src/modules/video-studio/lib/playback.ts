/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Starting a clip pauses the others (one video plays at a time on the page). Needs a document: called from a player's `onPlay`. */
export function pauseOthers(playing: HTMLVideoElement, root: Pick<Document, 'querySelectorAll'> = document): void {
  root.querySelectorAll('video').forEach((video) => {
    if (video !== playing) video.pause()
  })
}
