/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { Section } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { UpdateAdvisory } from '../types'
import { AdviceBlock } from './AdviceBlock'

/**
 * The advice kept from earlier analyses, shown while the check is still running or when it cannot run (no network): they come from the
 * local database. Each one says which update it is about; `stale` ones are marked once a check has been read.
 */
export function SavedAdvisories({ advisories, onForget }: { advisories: UpdateAdvisory[]; onForget: (id: string) => void }) {
  const t = useT()
  if (advisories.length === 0) return null
  return (
    <Section title={t('updates.advice.saved.title')}>
      <Box component="p" sx={{ m: 0, mb: 1.25, fontSize: 11.5, color: 'var(--faint)' }}>{t('updates.advice.saved.hint')}</Box>
      <Box sx={{ display: 'grid', gap: 1.75 }}>
        {advisories.map((a) => (
          <Box key={a.id}>
            <Box sx={{ fontSize: 13, color: 'var(--ink)' }}>
              {a.item_id}
              <Box component="span" sx={{ ml: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color: 'var(--faint)' }}>{a.from_version ?? '?'} → {a.to_version}</Box>
            </Box>
            <AdviceBlock advice={a} onForget={() => onForget(a.id)} />
          </Box>
        ))}
      </Box>
    </Section>
  )
}
