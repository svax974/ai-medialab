/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { voiceFacts, voiceQuote } from '../lib/voiceMeta'
import type { Voice } from '../types'
import { SamplePlayer } from './SamplePlayer'
import { VoiceAvatar } from './VoiceAvatar'

interface Props {
  voice: Voice
  onEdit: (voice: Voice) => void
  onDelete: (voice: Voice) => void
  /** "Write with this voice": the page decides what that means (the composer of the audio studio). */
  onUse: (voice: Voice) => void
}

function Facts({ voice }: { voice: Voice }) {
  const t = useT()
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>
      {voiceFacts(voice).map((fact, index) => {
        const text = fact.kind === 'type' ? t(fact.key) : fact.kind === 'language' ? fact.code.toUpperCase() : fact.kind === 'duration' ? formatClock(fact.seconds) : t('voices.card.noTranscript')
        return (
          <Box component="span" key={fact.kind} sx={fact.kind === 'noTranscript' ? { color: 'var(--warn)' } : undefined}>{index > 0 ? '· ' : ''}{text}</Box>
        )
      })}
    </Box>
  )
}

/** A voice of the library: name and facts, edit and delete, a player on its sample, its transcript, and "Write with this voice". */
export function VoiceCard({ voice, onEdit, onDelete, onUse }: Props) {
  const t = useT()
  const quote = voiceQuote(voice)
  return (
    <Box component="article" sx={{ borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', p: 2, animation: 'var(--animate-rise)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <VoiceAvatar name={voice.name} size={38} library />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box component="h3" sx={{ m: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{voice.name}</Box>
          <Facts voice={voice} />
        </Box>
        <TipIconButton labelId="voices.card.edit" size="small" onClick={() => onEdit(voice)}><EditOutlined sx={{ fontSize: 14 }} /></TipIconButton>
        <TipIconButton labelId="voices.card.delete" tone="danger" size="small" onClick={() => onDelete(voice)}><DeleteOutlineRounded sx={{ fontSize: 14 }} /></TipIconButton>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <SamplePlayer id={voice.id} url={voice.url ? resolveMediaUrl(voice.url) : null} peaks={voice.peaks} duration={voice.duration ?? 0} variant="inline" clock={false} />
      </Box>
      {quote && <Box component="p" sx={{ m: 0, mt: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12.5, fontStyle: 'italic', lineHeight: 1.35, color: 'var(--muted)' }}>« {quote} »</Box>}
      <Button variant="outlined" color="inherit" fullWidth onClick={() => onUse(voice)} startIcon={<AudiotrackRounded sx={{ fontSize: 16 }} />} sx={{ mt: 1.5 }}>{t('voices.card.use')}</Button>
    </Box>
  )
}
