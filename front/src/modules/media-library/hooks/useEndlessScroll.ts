/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react'
import { PREFETCH_MARGIN } from '../lib/gallery'

/**
 * Ref for an element at the end of a list: when it comes within `PREFETCH_MARGIN` of the visible area and more pages
 * exist, `onMore` is called (the next page is read before the user reaches the end).
 */
export function useEndlessScroll<T extends HTMLElement>(canLoadMore: boolean, onMore: () => void) {
  const sentinel = useRef<T>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !canLoadMore || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && onMore(), { rootMargin: PREFETCH_MARGIN })
    observer.observe(element)
    return () => observer.disconnect()
  }, [canLoadMore, onMore])
  return sentinel
}
