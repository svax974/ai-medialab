/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { useT } from '../hooks/useT'

/** Placeholder of a page that an H4 task fills: title, "coming soon" and a one-line explanation. */
export function ComingSoonPage({ titleKey, title }: { titleKey: string; title?: string }) {
  const t = useT()
  return (
    <Box sx={{ display: 'grid', flex: 1, placeItems: 'center', p: 4, textAlign: 'center' }}>
      <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', maxWidth: 480 }}>
        <Box className="cn-eyebrow">{t('studio.comingSoon.eyebrow')}</Box>
        <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 40, lineHeight: 1.1, color: 'var(--ink)' }}>
          {title ?? t(titleKey)}
        </Box>
        <Box sx={{ fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{t('studio.comingSoon.body')}</Box>
      </Box>
    </Box>
  )
}
