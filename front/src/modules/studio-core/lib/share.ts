/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export type ShareTargetId = 'mail' | 'whatsapp' | 'messages' | 'x' | 'facebook' | 'instagram'

export interface ShareTarget {
  id: ShareTargetId
  appleOnly?: boolean
}

/** Services of the menu; the server opens each one on this computer (`POST /api/assets/:id/share`). */
export const SHARE_TARGETS: ShareTarget[] = [
  { id: 'mail' },
  { id: 'whatsapp' },
  { id: 'messages', appleOnly: true },
  { id: 'x' },
  { id: 'facebook' },
  { id: 'instagram' },
]

export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
}

/** Targets offered on this machine (Messages only on Apple systems). */
export function shareTargets(): ShareTarget[] {
  const apple = isApplePlatform()
  return SHARE_TARGETS.filter((target) => !target.appleOnly || apple)
}

/** Whether the system share sheet exists in this window (it is the only way to attach the file itself). */
export function hasSystemShare(): boolean {
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

/** Reads the media into a `File` for the share sheet (`url`: an asset's, or a light copy's, already resolved). */
export async function loadShareFile(url: string, name: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type })
}

/** Opens the system share sheet with the file. Resolves false when the user closes it. */
export async function shareWithSystem(file: File, text: string): Promise<boolean> {
  const data: ShareData = { files: [file], title: file.name, ...(text ? { text } : {}) }
  if (!navigator.canShare(data)) throw new Error('unsupported')
  try {
    await navigator.share(data)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false
    throw error
  }
}
