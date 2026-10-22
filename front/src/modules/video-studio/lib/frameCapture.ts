/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Why a frame could not be taken: the video cannot be played, or the canvas could not be read. Locale keys of `videoStudio.capture.*`. */
export class FrameCaptureError extends Error {
  constructor(readonly key: 'videoStudio.capture.playFailed' | 'videoStudio.capture.failed') {
    super(key)
    this.name = 'FrameCaptureError'
  }
}

/** Moment of the frame to take: `last` is a hair before the end (the very last instant is often blank). */
export function captureTime(at: 'last' | number, duration: number): number {
  return at === 'last' ? Math.max(0, duration - 0.06) : Math.min(at, duration)
}

function release(video: HTMLVideoElement): void {
  video.removeAttribute('src')
  video.load()
}

/**
 * Draws one frame of a video to a PNG file (by default the last one). The video is requested with CORS (`crossOrigin`), so the canvas
 * stays readable whether the media comes from the same origin (the packaged app) or from the back's port (dev). A browser is needed (a `video` element and a canvas): not exercised by the tests.
 */
export function captureFrame(url: string, at: 'last' | number = 'last'): Promise<File> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    // The page and the media may be on two origins (dev: front 5173, back 3000): the canvas stays readable only if the server allows it (CORS).
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    const fail = (key: FrameCaptureError['key']) => {
      release(video)
      reject(new FrameCaptureError(key))
    }
    video.onerror = () => fail('videoStudio.capture.playFailed')
    video.onloadedmetadata = () => {
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          canvas.getContext('2d')?.drawImage(video, 0, 0)
          canvas.toBlob((blob) => {
            release(video)
            if (blob) resolve(new File([blob], at === 'last' ? 'derniere-image.png' : 'image.png', { type: 'image/png' }))
            else reject(new FrameCaptureError('videoStudio.capture.failed'))
          }, 'image/png')
        } catch {
          fail('videoStudio.capture.failed')
        }
      }
      video.currentTime = captureTime(at, video.duration)
    }
    video.src = url
  })
}
