/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { WelcomeSetup } from '@/modules/engines'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { OcrComposer } from './OcrComposer'

const rise = (delay: number) => ({ animation: 'var(--animate-rise)', animationDelay: `${delay}ms` })

/** Home of the OCR tab: the headline, the first-launch card (a model to install) and the composer. */
export function OcrHome() {
  const t = useT()
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', overflowY: 'auto' }}>
      <Box sx={{ pointerEvents: 'none', position: 'absolute', left: '50%', top: '-20%', width: '80vw', height: '60vh', transform: 'translateX(-50%)', borderRadius: '50%', background: 'radial-gradient(closest-side, var(--safe-soft), transparent)', filter: 'blur(40px)' }} />
      <Box sx={{ position: 'relative', mx: 'auto', display: 'flex', width: '100%', maxWidth: 820, flex: 1, flexDirection: 'column', justifyContent: 'center', px: 2.5, py: 8 }}>
        <Box sx={{ mb: 4.5, textAlign: 'center' }}>
          <Box className="cn-eyebrow" sx={{ mb: 2, ...rise(0) }}>{t('ocrStudio.home.eyebrow')}</Box>
          <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 68px)', lineHeight: 0.95, letterSpacing: '-0.02em', color: 'var(--ink)', ...rise(60) }}>
            {t('ocrStudio.home.title.before')} <Box component="em" sx={{ color: 'var(--safe)' }}>{t('ocrStudio.home.title.accent')}</Box>
            {t('ocrStudio.home.title.after')}
          </Box>
          <Box component="p" sx={{ mx: 'auto', mb: 0, mt: 2, maxWidth: 480, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', ...rise(120) }}>{t('ocrStudio.home.subtitle')}</Box>
        </Box>
        <Box sx={rise(180)}>
          <WelcomeSetup kind="ocr" />
          <OcrComposer />
        </Box>
      </Box>
    </Box>
  )
}
