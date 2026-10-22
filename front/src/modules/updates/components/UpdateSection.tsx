/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Button } from '@mui/material'
import { Section } from '@/modules/model-catalog'

interface UpdateSectionProps {
  title: string
  /** Label of the "update all" button of the section (it carries the count). */
  allLabel: string
  /** How many updates that button would start; 0 hides it. */
  pending: number
  onUpdateAll: () => void
  /** Text shown instead of the rows when the section has none. */
  empty: string
  children: ReactNode[]
}

/** A card of the dialog: its title with the button that updates everything in it, then the rows. */
export function UpdateSection({ title, allLabel, pending, onUpdateAll, empty, children }: UpdateSectionProps) {
  return (
    <Section
      title={
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <span>{title}</span>
          {pending > 0 && (
            <Button size="small" variant="outlined" onClick={onUpdateAll}>
              {allLabel}
            </Button>
          )}
        </Box>
      }
    >
      {children.length === 0 ? (
        <Box component="p" sx={{ m: 0, fontSize: 13, color: 'var(--muted)' }}>{empty}</Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.75 }}>{children}</Box>
      )}
    </Section>
  )
}
