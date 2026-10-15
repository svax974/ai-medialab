/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useChatDraftStore } from '../state/chatDraftStore'

const SUGGESTIONS = ['explain', 'write', 'code', 'imagePrompt'] as const

/** Four starter messages that fill the composer (an empty conversation, the home page). */
export function ChatSuggestions({ draftKey }: { draftKey: string }) {
  const t = useT()
  const setText = useChatDraftStore((s) => s.setText)
  return (
    <Box sx={{ mt: 2.5, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {SUGGESTIONS.map((id) => (
        <ButtonBase key={id} onClick={() => { setText(draftKey, t(`chat.suggest.${id}.prompt`)); focusTarget('composer') }} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', px: 2, py: 1.5, textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s', '&:hover': { borderColor: 'var(--line-strong)', backgroundColor: 'var(--surface)' }, '&:hover .arrow': { color: 'var(--ink)' } }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box className="cn-eyebrow" sx={{ mb: '4px', color: 'var(--safe)' }}>{t(`chat.suggest.${id}.label`)}</Box>
            <Box sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 13, lineHeight: 1.35, color: 'var(--ink-2)' }}>{t(`chat.suggest.${id}.prompt`)}</Box>
          </Box>
          <ArrowOutwardRounded className="arrow" sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--faint)', transition: 'color 0.15s' }} />
        </ButtonBase>
      ))}
    </Box>
  )
}
