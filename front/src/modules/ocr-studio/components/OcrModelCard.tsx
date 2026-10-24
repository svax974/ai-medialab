/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ReportGmailerrorredRounded from '@mui/icons-material/ReportGmailerrorredRounded'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'

function Points({ items, tone }: { items: string[]; tone: 'safe' | 'warn' }) {
  const Icon = tone === 'safe' ? CheckRounded : ReportGmailerrorredRounded
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
      {items.map((item) => (
        <Box component="li" key={item} sx={{ display: 'flex', gap: '8px', fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-2)' }}>
          <Icon sx={{ mt: '1px', fontSize: 14, flexShrink: 0, color: `var(--${tone})` }} />
          {item}
        </Box>
      ))}
    </Box>
  )
}

/** The card of an OCR model: what it is for, its strengths and its limits, its languages and licence, so that the choice is informed. */
export function OcrModelCard({ model }: { model: ModelInfo }) {
  const t = useT()
  const caps = model.ocr
  if (!caps) return null
  return (
    <Box sx={{ borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', p: 2 }}>
      <Box sx={{ mb: 1.25, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>{model.description}</Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <Box>
          <Box className="cn-eyebrow" sx={{ mb: '6px', color: 'var(--safe)' }}>{t('ocrStudio.model.strengths')}</Box>
          <Points items={caps.strengths} tone="safe" />
        </Box>
        <Box>
          <Box className="cn-eyebrow" sx={{ mb: '6px', color: 'var(--warn)' }}>{t('ocrStudio.model.weaknesses')}</Box>
          <Points items={caps.weaknesses} tone="warn" />
        </Box>
      </Box>
      <Box sx={{ mt: 1.25, fontSize: 11.5, color: 'var(--faint)' }}>
        {t('ocrStudio.model.meta', [caps.languages || t('ocrStudio.model.languagesUnknown'), model.license || t('ocrStudio.model.licenseUnknown')])}
      </Box>
    </Box>
  )
}
