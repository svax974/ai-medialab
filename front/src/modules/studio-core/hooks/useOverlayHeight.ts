/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react'

/**
 * Height of an element that floats over the thread (the composer): the thread keeps that much room at its bottom, so its
 * last message can always be scrolled above the composer, whatever the composer grows to (attachments, negative prompt,
 * wrapped controls). Use the returned `ref` on the floating element.
 */
export function useOverlayHeight(): [(el: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0)
  const [observer] = useState(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.target as HTMLElement | undefined
    if (box) setHeight(box.offsetHeight)
  })))
  const ref = useCallback((el: HTMLElement | null) => {
    observer?.disconnect()
    if (!el) return
    setHeight(el.offsetHeight)
    observer?.observe(el)
  }, [observer])
  return [ref, height]
}
