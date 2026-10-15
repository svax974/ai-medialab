/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'react'

/** A value that follows `value` at most once every `ms` (the last value always arrives); `ms` 0 follows at once. */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    if (ms <= 0) {
      setShown(value)
      return undefined
    }
    const wait = Math.max(0, last.current + ms - Date.now())
    const timer = setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, wait)
    return () => clearTimeout(timer)
  }, [value, ms])
  return shown
}
