/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { KEEP_ALIVE_OPTIONS } from '../lib/settingsConfig'

/** Segmented choice of the delay before the idle model is unloaded. */
export function KeepAliveControl({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const t = useT()
  return (
    <Box
      role="radiogroup"
      aria-label={t('settings.keepAlive.aria')}
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', p: '4px', borderRadius: '12px', backgroundColor: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
    >
      {KEEP_ALIVE_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <ButtonBase
            key={option.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            sx={{
              py: '6px',
              borderRadius: '8px',
              fontSize: 12.5,
              fontFamily: 'inherit',
              transition: 'background-color 0.15s, color 0.15s',
              color: selected ? 'var(--ink)' : 'var(--muted)',
              backgroundColor: selected ? 'var(--surface-3)' : 'transparent',
              boxShadow: selected ? '0 1px 2px rgb(0 0 0 / 0.25)' : 'none',
              '&:hover': { color: 'var(--ink)' },
            }}
          >
            {t(option.labelId)}
          </ButtonBase>
        )
      })}
    </Box>
  )
}
