/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'

/** Current time in epoch seconds, refreshed every `interval` ms while `active` (an elapsed-time clock). */
export function useNow(active: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now() / 1000)
    const id = setInterval(() => setNow(Date.now() / 1000), interval)
    return () => clearInterval(id)
  }, [active, interval])
  return now
}
