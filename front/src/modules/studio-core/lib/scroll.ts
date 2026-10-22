/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Distance (px) from the bottom under which the thread counts as "at the bottom" (it then follows new content). */
export const BOTTOM_THRESHOLD = 80

export function isNearBottom(el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
}

/**
 * What to do with the scroll when the number of messages changes: jump to the bottom when the conversation opens (no
 * message was known yet), scroll smoothly when a message was added, nothing otherwise.
 */
export function scrollAction(previousCount: number, count: number): 'jump' | 'smooth' | null {
  if (previousCount === 0) return 'jump'
  return count > previousCount ? 'smooth' : null
}

/** Result of leaving the title field: an empty title is refused (the old one comes back), an unchanged one is not saved. */
export type TitleEdit = { action: 'revert' } | { action: 'save'; title: string } | { action: 'none' }

export function resolveTitleEdit(value: string, current: string): TitleEdit {
  const next = value.trim()
  if (!next) return { action: 'revert' }
  return next === current ? { action: 'none' } : { action: 'save', title: next }
}
