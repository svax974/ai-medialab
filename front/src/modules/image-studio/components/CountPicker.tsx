/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { PARAM_HELP } from '@/modules/studio-core'
import { HelpTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'

const COUNTS = [1, 2, 3, 4] as const

/** Number of images to generate (1 to 4), each with its own seed. */
export function CountPicker({ value, onChange }: { value: number; onChange: (count: number) => void }) {
  const t = useT()
  return (
    <HelpTooltip help={PARAM_HELP['count_images']}>
      <Box role="group" aria-label={t('imageStudio.count.aria')} sx={{ display: 'flex', height: 32, alignItems: 'center', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', p: '2px' }}>
        {COUNTS.map((count) => (
          <Box
            key={count}
            component="button"
            type="button"
            aria-pressed={value === count}
            onClick={() => onChange(count)}
            sx={{ height: '100%', width: 24, border: 0, borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: 12, transition: 'background-color 0.15s, color 0.15s', backgroundColor: value === count ? 'var(--surface-3)' : 'transparent', color: value === count ? 'var(--ink)' : 'var(--faint)', '&:hover': { color: 'var(--ink)' } }}
          >
            {count}
          </Box>
        ))}
      </Box>
    </HelpTooltip>
  )
}
