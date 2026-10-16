/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Box, MenuItem, Select } from '@mui/material'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVoices } from '@/modules/voices'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { SETTINGS_HELP } from '../lib/settingsConfig'

/**
 * The voice the chat's audio tool speaks with when the request names none (a voice of the library with a sample). Only a
 * model that needs a voice uses it: the others have their own, and a voice named in the request always wins.
 */
export function ChatVoiceField() {
  const t = useT()
  const { data } = useSettings()
  const { data: voices = [] } = useVoices()
  const save = useSaveSettings()
  const usable = voices.filter((voice) => voice.url !== null)
  const current = usable.some((voice) => voice.id === data?.chat_voice_id) ? (data?.chat_voice_id ?? '') : ''
  return (
    <Box component="section" sx={{ border: '1px solid var(--line)', borderRadius: '16px', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: '4px', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
        <GraphicEqRounded sx={{ fontSize: 16, color: 'var(--muted)' }} />
        {t('settings.chatVoice.title')}
        <InfoTip {...SETTINGS_HELP.chatVoice} />
      </Box>
      <Box component="p" sx={{ m: 0, mb: '10px', fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>{t(usable.length > 0 ? 'settings.chatVoice.description' : 'settings.chatVoice.empty')}</Box>
      <Select size="small" fullWidth displayEmpty value={current} disabled={usable.length === 0 || save.isPending} onChange={(event) => save.mutate({ chat_voice_id: event.target.value })} inputProps={{ 'aria-label': t('settings.chatVoice.aria') }}>
        <MenuItem value="">{t('settings.chatVoice.none')}</MenuItem>
        {usable.map((voice) => <MenuItem key={voice.id} value={voice.id}>{voice.name}</MenuItem>)}
      </Select>
    </Box>
  )
}
