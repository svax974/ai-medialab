/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { EngineDot } from '../lib/installState'

const DOT_COLOR: Record<EngineDot, string> = { ok: 'var(--ok)', warn: 'var(--warn)', faint: 'var(--faint)' }

/** One line of an installer card: status dot, name, remark and the button(s) that fit the state. */
export function InstallRow({ dot, name, extra, remark, actions }: { dot: EngineDot; name: string; extra?: ReactNode; remark: string; actions?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
      <Box component="span" aria-hidden sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', backgroundColor: DOT_COLOR[dot] }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ fontSize: 13.5, color: 'var(--ink)' }}>
          {name}
          {extra}
        </Box>
        <Box sx={{ fontSize: 11.5, lineHeight: 1.4, color: 'var(--faint)' }}>{remark}</Box>
      </Box>
      {actions}
    </Box>
  )
}
