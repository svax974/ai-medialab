/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export type ShortcutAction = 'toggleSidebar' | 'newCreation' | 'focusComposer' | 'focusSearch'

/** The parts of a `KeyboardEvent` the shortcuts read. */
export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export interface ShortcutContext {
  /** Focus is in a text field: plain keys (`/`) must type, not trigger. */
  typing: boolean
  /** A dialog or the lightbox is open: plain keys are ignored. */
  blocked: boolean
}

/**
 * Shortcut of a key press, or `null`. Cmd (macOS) and Ctrl both count as the modifier.
 * Cmd+B hides/shows the panel, Cmd+Shift+O starts a new creation, Cmd+K searches, `/` focuses the composer.
 */
export function resolveShortcut(event: KeyLike, context: ShortcutContext): ShortcutAction | null {
  const modifier = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (modifier && !event.altKey) {
    if (key === 'b' && !event.shiftKey) return 'toggleSidebar'
    if (key === 'o' && event.shiftKey) return 'newCreation'
    if (key === 'k' && !event.shiftKey) return 'focusSearch'
    return null
  }
  if (event.key === '/' && !modifier && !event.altKey && !context.typing && !context.blocked) return 'focusComposer'
  return null
}

/** Whether an event target is a text field (`input`, `textarea`, contenteditable). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null
  return typeof element?.closest === 'function' && element.closest('input, textarea, select, [contenteditable]') !== null
}

/** Display form of the shortcuts (tooltips). */
export const SHORTCUT_LABELS = {
  toggleSidebar: '⌘B',
  newCreation: '⌘⇧O',
  focusSearch: '⌘K',
  focusComposer: '/',
} as const
