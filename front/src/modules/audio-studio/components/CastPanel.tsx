/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import GroupsRounded from '@mui/icons-material/GroupsRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { VoiceRef } from '@/modules/voices'
import { AUDIO_HELP } from '../lib/audioHelp'
import { VoicePicker } from './VoicePicker'

interface Props {
  model: ModelInfo
  language: string
  speakers: readonly string[]
  voiceOf: (name: string, index: number) => VoiceRef | undefined
  onCast: (name: string, voice: VoiceRef) => void
  onPlainText: () => void
}

/** "Script with N voices": a voice picker per character of the dialogue, and a way back to a plain text. */
export function CastPanel({ model, language, speakers, voiceOf, onCast, onPlainText }: Props) {
  const t = useT()
  return (
    <Box sx={{ mx: 1.75, mb: 1, borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface-2) 60%, transparent)', px: 1.5, py: 1.25 }}>
      <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1, fontSize: 12, color: 'var(--ink-2)' }}>
        <GroupsRounded sx={{ fontSize: 14, color: 'var(--safe)' }} />
        <Box component="span" sx={{ fontWeight: 500, color: 'var(--ink)' }}>{t('audioStudio.cast.title', [speakers.length])}</Box>
        <InfoTip {...AUDIO_HELP.script} />
        <ButtonBase onClick={onPlainText} sx={{ ml: 'auto', fontSize: 11.5, color: 'var(--faint)', '&:hover': { color: 'var(--ink)' } }}>{t('audioStudio.cast.plain')}</ButtonBase>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {speakers.map((name, index) => (
          <VoicePicker key={name} compact label={name} model={model} language={language} value={voiceOf(name, index)} onChange={(voice) => onCast(name, voice)} />
        ))}
      </Box>
    </Box>
  )
}
