/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, TextField } from '@mui/material'
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined'
import { toast } from 'react-toastify'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { SETTINGS_HELP } from '../lib/settingsConfig'

/**
 * Brave Search API key (optional): the chat's web search uses Brave when one is saved, DuckDuckGo otherwise. The key is
 * write-only: the server stores it encrypted and only says whether one is saved (`has_brave_api_key`).
 */
export function BraveKeyField() {
  const t = useT()
  const [value, setValue] = useState('')
  const { data } = useSettings()
  const save = useSaveSettings((settings) => {
    setValue('')
    toast.success(t(settings.has_brave_api_key ? 'settings.braveKey.saved' : 'settings.braveKey.removed'))
  })
  return (
    <Box component="section" sx={{ border: '1px solid var(--line)', borderRadius: '16px', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: '4px', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
        <TravelExploreOutlined sx={{ fontSize: 16, color: 'var(--muted)' }} />
        {t('settings.braveKey.title')}
        <Box component="span" sx={{ fontWeight: 400, color: 'var(--faint)' }}>{t('settings.braveKey.optional')}</Box>
        <InfoTip {...SETTINGS_HELP.braveKey} />
      </Box>
      <Box component="p" sx={{ m: 0, mb: '10px', fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>
        {t('settings.braveKey.description')}
        {data?.has_brave_api_key && <Box component="span" sx={{ color: 'var(--ok)' }}> {t('settings.braveKey.present')}</Box>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          type="password"
          size="small"
          fullWidth
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('settings.braveKey.placeholder')}
          autoComplete="off"
          slotProps={{ htmlInput: { 'aria-label': t('settings.braveKey.aria'), style: { fontFamily: 'var(--font-mono)' } } }}
        />
        <Button variant="outlined" disabled={!value.trim() || save.isPending} onClick={() => save.mutate({ brave_api_key: value })}>{t('settings.braveKey.save')}</Button>
        {data?.has_brave_api_key && <Button variant="text" disabled={save.isPending} onClick={() => save.mutate({ brave_api_key: '' })}>{t('settings.braveKey.remove')}</Button>}
      </Box>
    </Box>
  )
}
