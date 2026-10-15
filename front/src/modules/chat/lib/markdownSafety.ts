/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

const SAFE_LINK = /^(https?:|mailto:)/i

/** Whether a link of a model's answer may be opened: web pages and mail only (never `javascript:`, `data:`, `file:`...). */
export const isSafeHref = (href: string | undefined): href is string => !!href && SAFE_LINK.test(href.trim())

/** An image that would be fetched from the network when drawn: blocked until the user asks for it (privacy). */
export const isRemoteImage = (src: string | undefined): boolean => !!src && /^(https?:)?\/\//i.test(src.trim())

/** Host of a URL for display (`example.com`), or the text itself when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
