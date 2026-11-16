/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Box, Typography } from '@mui/material'
import { useParams } from 'react-router-dom'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { TranscriptComposer } from './TranscriptComposer'
import { TranscriptResult } from './TranscriptResult'

export function TranscriptPage() {
  const { id } = useParams()
  const t = useT()
  if (id) return <TranscriptResult key={id} id={id} />
  return <Box sx={{ position: 'relative', width: '100%', minHeight: 0, flex: 1, overflowY: 'auto' }}>
    <Box sx={{ maxWidth: 880, mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 4, md: 7 }, animation: 'var(--animate-rise)' }}>
      <Typography sx={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--safe)', mb: 2 }}>{t('transcription.heading')}</Typography>
      <Typography component="h1" sx={{ fontFamily: 'var(--font-display)', fontSize: { xs: 36, md: 54 }, fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 1.12, mb: 2 }}>{t('transcription.hero')}</Typography>
      <Typography sx={{ color: 'var(--muted)', fontSize: 15, maxWidth: 600, lineHeight: 1.7, mb: 4 }}>{t('transcription.subtitle')}</Typography>
      <TranscriptComposer />
    </Box>
  </Box>
}
