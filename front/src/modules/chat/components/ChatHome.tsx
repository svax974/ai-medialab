/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { WelcomeSetup } from '@/modules/engines'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { HOME_DRAFT } from '../state/chatDraftStore'
import { ChatComposer } from './ChatComposer'
import { ChatSuggestions } from './ChatSuggestions'

const rise = (delay: number) => ({ animation: 'var(--animate-rise)', animationDelay: `${delay}ms` })

/**
 * Home page of the chat: the headline, the first-launch card (a model and the engine to install), the hero composer
 * (its settings are the defaults of new conversations) and four starter messages. A safelight glow floats behind.
 */
export function ChatHome() {
  const t = useT()
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', overflowY: 'auto' }}>
      <Box sx={{ pointerEvents: 'none', position: 'absolute', left: '50%', top: '-20%', width: '80vw', height: '60vh', transform: 'translateX(-50%)', borderRadius: '50%', background: 'radial-gradient(closest-side, var(--safe-soft), transparent)', filter: 'blur(40px)' }} />
      <Box sx={{ position: 'relative', mx: 'auto', display: 'flex', width: '100%', maxWidth: 820, flex: 1, flexDirection: 'column', justifyContent: 'center', px: 2.5, py: 8 }}>
        <Box sx={{ mb: 4.5, textAlign: 'center' }}>
          <Box className="cn-eyebrow" sx={{ mb: 2, ...rise(0) }}>{t('chat.home.eyebrow')}</Box>
          <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 68px)', lineHeight: 0.95, letterSpacing: '-0.02em', color: 'var(--ink)', ...rise(60) }}>
            {t('chat.home.title.before')} <Box component="em" sx={{ color: 'var(--safe)' }}>{t('chat.home.title.accent')}</Box>{t('chat.home.title.after')}
          </Box>
          <Box component="p" sx={{ mx: 'auto', mb: 0, mt: 2, maxWidth: 448, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', ...rise(120) }}>{t('chat.home.subtitle')}</Box>
        </Box>
        <Box sx={rise(180)}>
          <WelcomeSetup kind="llm" />
          <ChatComposer conversationId={null} hero />
        </Box>
        <Box sx={rise(240)}>
          <ChatSuggestions draftKey={HOME_DRAFT} />
        </Box>
        <Box component="p" sx={{ mx: 'auto', mt: 3, mb: 0, maxWidth: 520, textAlign: 'center', fontSize: 12, lineHeight: 1.5, color: 'var(--faint)', ...rise(300) }}>{t('chat.home.privacy')}</Box>
      </Box>
    </Box>
  )
}
