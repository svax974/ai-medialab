/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Tooltip } from '@mui/material'
import { HelpBody, helpTooltipSlotProps, type Help, type TipSide } from '@/modules_shared/common/components/ui/help'
import { Kbd } from '@/modules_shared/common/components/ui/kbd'

/**
 * Rich tooltip (title, body, advice) around any control that is not an icon button (a text button, a segmented control,
 * a thumbnail badge). The wrapper span lets the tooltip work on a disabled control.
 */
export function HelpTooltip({ help, children, side = 'top' }: { help: Help; children: ReactNode; side?: TipSide }) {
  return (
    <Tooltip title={<HelpBody {...help} />} placement={side} enterDelay={350} slotProps={helpTooltipSlotProps}>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        {children}
      </Box>
    </Tooltip>
  )
}

/** One-line tooltip with an optional shortcut, for a control that is not an icon button (the "Generate" button). */
export function LabelTooltip({ label, kbd, children, side = 'top' }: { label: string; kbd?: string; children: ReactNode; side?: TipSide }) {
  return (
    <Tooltip
      title={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </Box>
      }
      placement={side}
      enterDelay={350}
      slotProps={helpTooltipSlotProps}
    >
      <Box component="span" sx={{ display: 'inline-flex' }}>
        {children}
      </Box>
    </Tooltip>
  )
}
