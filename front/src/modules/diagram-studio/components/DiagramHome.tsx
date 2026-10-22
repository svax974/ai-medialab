/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import { WelcomeSetup } from '@/modules/engines'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { SUGGESTIONS } from '../lib/suggestions'
import { useDiagramDraftStore } from '../state/diagramDraftStore'
import { Composer } from './Composer'

const rise = (delay: number) => ({ animation: 'var(--animate-rise)', animationDelay: `${delay}ms` })

function Suggestions() {
  const t = useT()
  const setPrompt = useDiagramDraftStore((s) => s.setPrompt)
  const setDiagramType = useDiagramDraftStore((s) => s.setDiagramType)
  return (
    <Box sx={{ mt: 2.5, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, ...rise(240) }}>
      {SUGGESTIONS.map((suggestion) => (
        <ButtonBase
          key={suggestion.labelKey}
          onClick={() => {
            setPrompt(t(suggestion.promptKey))
            setDiagramType(suggestion.diagramType)
            focusTarget('composer')
          }}
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', px: 2, py: 1.5, textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s', '&:hover': { borderColor: 'var(--line-strong)', backgroundColor: 'var(--surface)' }, '&:hover .arrow': { color: 'var(--ink)' } }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box className="cn-eyebrow" sx={{ mb: '4px', color: 'var(--safe)' }}>{t(suggestion.labelKey)}</Box>
            <Box sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 13, lineHeight: 1.35, color: 'var(--ink-2)' }}>{t(suggestion.promptKey)}</Box>
          </Box>
          <ArrowOutwardRounded className="arrow" sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--faint)', transition: 'color 0.15s' }} />
        </ButtonBase>
      ))}
    </Box>
  )
}

/**
 * Home page of the diagram studio: the headline, the first-launch card (a model to install), the hero composer and
 * four starter prompts that fill it (one per diagram type). No "latest" strip: a rendered diagram is stored as a
 * plain image asset like any other generation (see `diagramStudioAdapter.tsx`), so a recency strip here would mix it
 * with photo-realistic image generations from the Image tab.
 */
export function DiagramHome() {
  const t = useT()
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', overflowY: 'auto' }}>
      <Box sx={{ pointerEvents: 'none', position: 'absolute', left: '50%', top: '-20%', width: '80vw', height: '60vh', transform: 'translateX(-50%)', borderRadius: '50%', background: 'radial-gradient(closest-side, var(--safe-soft), transparent)', filter: 'blur(40px)' }} />
      <Box sx={{ position: 'relative', mx: 'auto', display: 'flex', width: '100%', maxWidth: 820, flex: 1, flexDirection: 'column', justifyContent: 'center', px: 2.5, py: 8 }}>
        <Box sx={{ mb: 4.5, textAlign: 'center' }}>
          <Box className="cn-eyebrow" sx={{ mb: 2, ...rise(0) }}>{t('diagramStudio.home.eyebrow')}</Box>
          <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 68px)', lineHeight: 0.95, letterSpacing: '-0.02em', color: 'var(--ink)', ...rise(60) }}>
            {t('diagramStudio.home.title.before')} <Box component="em" sx={{ color: 'var(--safe)' }}>{t('diagramStudio.home.title.accent')}</Box>
            {t('diagramStudio.home.title.after')}
          </Box>
          <Box component="p" sx={{ mx: 'auto', mb: 0, mt: 2, maxWidth: 448, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', ...rise(120) }}>{t('diagramStudio.home.subtitle')}</Box>
        </Box>
        <Box sx={rise(180)}>
          <WelcomeSetup kind="diagram" />
          <Composer conversationId={null} hero />
        </Box>
        <Suggestions />
      </Box>
    </Box>
  )
}
