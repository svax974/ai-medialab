/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/**
 * Focus targets shared by the shell and the pages: the composers (H4) register their field, the shell shortcuts
 * (`/`, Cmd+Shift+O, Cmd+K) focus them without knowing the page.
 */
export type FocusTarget = 'composer' | 'search'

type Focusable = { focus: () => void; select?: () => void; setSelectionRange?: (start: number, end: number) => void; value?: string }

const targets = new Map<FocusTarget, Focusable>()

/** Register (or clear with `null`) the element of a target. */
export function registerFocusTarget(target: FocusTarget, element: Focusable | null): void {
  if (element) targets.set(target, element)
  else targets.delete(target)
}

/** Focus a target on the next frame (the page may be mounting). `selectAll` selects its content, else the caret goes to the end. */
export function focusTarget(target: FocusTarget, selectAll = false): void {
  requestAnimationFrame(() => {
    const element = targets.get(target)
    if (!element) return
    element.focus()
    if (selectAll) element.select?.()
    else if (typeof element.value === 'string') element.setSelectionRange?.(element.value.length, element.value.length)
  })
}
