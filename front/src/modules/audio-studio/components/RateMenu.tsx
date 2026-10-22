/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Menu, MenuItem } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const

/** Playback speed of the shared player (global to the tab): a button with the rate, a menu of five speeds. */
export function RateMenu({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <TipIconButton labelId="audioStudio.take.rate" onClick={(event) => setAnchor(event.currentTarget)} sx={{ borderRadius: '8px', px: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{rate}×</TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 96 } } }}>
        {PLAYBACK_RATES.map((value) => (
          <MenuItem key={value} selected={value === rate} onClick={() => { onChange(value); setAnchor(null) }} sx={{ gap: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
            <Box component="span" sx={{ display: 'grid', width: 16, placeItems: 'center' }}>{value === rate && <CheckRounded sx={{ fontSize: 14, color: 'var(--safe)' }} />}</Box>
            {value}×
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
