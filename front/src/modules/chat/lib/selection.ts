/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** The text the user has selected inside `root` (nothing when the selection is elsewhere on the page, or empty). */
export function selectedTextWithin(root: Node | null): string {
  if (!root || typeof window === 'undefined') return ''
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  return root.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.toString() : ''
}
