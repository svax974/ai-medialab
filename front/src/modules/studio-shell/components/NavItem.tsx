/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, ButtonBase } from '@mui/material'
import { Link } from 'react-router-dom'
import { Kbd } from '@/modules_shared/common/components/ui/kbd'

interface NavItemProps {
  to: string
  active: boolean
  icon: ReactNode
  label: string
  kbd?: string
}

/** Sidebar entry: icon, label and, on hover, its shortcut. */
export function NavItem({ to, active, icon, label, kbd }: NavItemProps) {
  return (
    <ButtonBase
      component={Link}
      to={to}
      aria-current={active ? 'page' : undefined}
      sx={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        height: 36,
        px: 1.5,
        borderRadius: '12px',
        fontSize: 14,
        fontFamily: 'inherit',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        backgroundColor: active ? 'var(--surface-3)' : 'transparent',
        transition: 'background-color 0.15s, color 0.15s',
        '&:hover': { backgroundColor: active ? 'var(--surface-3)' : 'var(--surface-2)', color: 'var(--ink)' },
        '&:hover .nav-kbd, &.Mui-focusVisible .nav-kbd': { opacity: 1 },
      }}
    >
      {icon}
      <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
        {label}
      </Box>
      {kbd && (
        <Box component="span" className="nav-kbd" sx={{ opacity: 0, transition: 'opacity 0.15s', display: 'inline-flex' }}>
          <Kbd>{kbd}</Kbd>
        </Box>
      )}
    </ButtonBase>
  )
}
