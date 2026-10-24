/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '../types'

export type ShareTargetId = 'mail' | 'whatsapp' | 'messages' | 'x'

export interface ShareTarget {
  id: ShareTargetId
  /** Link that opens the service with the text prefilled (a web link cannot carry the file of a local app). */
  href: (text: string, title: string) => string
  appleOnly?: boolean
}

export const SHARE_TARGETS: ShareTarget[] = [
  { id: 'mail', href: (text, title) => `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}` },
  { id: 'whatsapp', href: (text) => `https://wa.me/?text=${encodeURIComponent(text)}` },
  { id: 'messages', href: (text) => `sms:&body=${encodeURIComponent(text)}`, appleOnly: true },
  { id: 'x', href: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}` },
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

/** Reads the media into a `File` for the share sheet. */
export async function loadShareFile(asset: Asset, name: string): Promise<File> {
  const response = await fetch(resolveMediaUrl(asset.url))
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

/** Opens a service with the text. `mailto:` and `sms:` go to the system, the web links to the browser. */
export function openShareTarget(target: ShareTarget, text: string, title: string): void {
  const href = target.href(text, title)
  if (/^https?:/.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  else window.location.href = href
}
