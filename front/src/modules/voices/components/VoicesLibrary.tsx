/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { useDeleteVoice } from '../hooks/useVoiceActions'
import { useVoices } from '../hooks/useVoices'
import { useVoiceStudioStore } from '../state/voiceStudioStore'
import type { Voice } from '../types'
import { VoiceCard } from './VoiceCard'

function EmptyLibrary({ onRecord }: { onRecord: () => void }) {
  const t = useT()
  return (
    <Box sx={{ mx: 'auto', mt: 8, maxWidth: 448, textAlign: 'center' }}>
      <Box sx={{ mx: 'auto', mb: 2.5, display: 'grid', width: 64, height: 64, placeItems: 'center', borderRadius: '50%', backgroundColor: 'var(--surface-2)', color: 'var(--safe)', boxShadow: '0 0 0 1px var(--line)' }}><MicRounded sx={{ fontSize: 28 }} /></Box>
      <Box component="h2" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, color: 'var(--ink)' }}>
        {t('voices.empty.title.before')}<Box component="em" sx={{ color: 'var(--safe)' }}>{t('voices.empty.title.accent')}</Box>{t('voices.empty.title.after')}
      </Box>
      <Box component="p" sx={{ mb: 0, mt: 1.5, fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{t('voices.empty.body')}</Box>
      <Button variant="contained" onClick={onRecord} startIcon={<MicRounded sx={{ fontSize: 16 }} />} sx={{ mt: 3 }}>{t('voices.empty.record')}</Button>
    </Box>
  )
}

/**
 * `/audio/voix`: the library of voices ("Mes voix"): count, "Add a voice", a card per voice (play, edit, delete, write with it)
 * and the empty invitation. `onUse` is given by the page: what "write with this voice" does belongs to the audio studio.
 */
export function VoicesLibrary({ onUse }: { onUse: (voice: Voice) => void }) {
  const t = useT()
  const { data: voices, isLoading } = useVoices()
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)
  const open = useVoiceStudioStore((s) => s.open)
  const deleteVoice = useDeleteVoice()
  return (
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
      <Box component="header" sx={{ display: 'flex', height: 56, flexShrink: 0, alignItems: 'center', gap: 1.5, borderBottom: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', px: 2.5, pl: sidebarOpen ? 2.5 : 7 }}>
        <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 24, color: 'var(--ink)' }}>{t('voices.page.title')}</Box>
        <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{t('voices.page.count', [voices?.length ?? 0])}</Box>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => open()} startIcon={<AddRounded sx={{ fontSize: 16 }} />}>{t('voices.page.add')}</Button>
      </Box>
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2.5 }}>
        {isLoading && <Box sx={{ display: 'grid', height: 160, placeItems: 'center', color: 'var(--muted)' }}><CircularProgress size={20} color="inherit" /></Box>}
        {!isLoading && voices?.length === 0 && <EmptyLibrary onRecord={() => open()} />}
        <Box sx={{ mx: 'auto', display: 'grid', maxWidth: 1000, gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {voices?.map((voice) => <VoiceCard key={voice.id} voice={voice} onEdit={(v) => open({ voiceId: v.id })} onDelete={(v) => void deleteVoice(v)} onUse={onUse} />)}
        </Box>
      </Box>
    </Box>
  )
}
