/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { Box } from '@mui/material'
import { usePrivateEvents } from '../hooks/usePrivateEvents'
import { usePrivateGuards } from '../hooks/usePrivateGuards'
import { usePrivateStore } from '../state/privateStore'
import { PRIVATE_COLOR } from './privateTheme'

/**
 * Mounted once in the studio shell: the session guards and events, the `data-private` mark on the page (for styles
 * and tests) and a coloured frame around the whole window while the mode is on (it never intercepts a click).
 */
export function PrivateHost() {
  usePrivateGuards()
  usePrivateEvents()
  const active = usePrivateStore((s) => s.active)
  useEffect(() => {
    document.documentElement.dataset.private = active ? 'true' : 'false'
    return () => {
      delete document.documentElement.dataset.private
    }
  }, [active])
  if (!active) return null
  return <Box aria-hidden sx={{ position: 'fixed', inset: 0, zIndex: 1500, pointerEvents: 'none', boxShadow: `inset 0 0 0 3px ${PRIVATE_COLOR}` }} />
}
