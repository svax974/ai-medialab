/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, TextField } from '@mui/material'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import { toast } from 'react-toastify'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { SETTINGS_HELP } from '../lib/settingsConfig'

/**
 * Hugging Face token (optional, for gated repositories). The token is write-only: the server only says whether one
 * is saved (`has_hf_token`). Reusable by the models dialog (H4.2).
 */
export function HfTokenField() {
  const t = useT()
  const [value, setValue] = useState('')
  const { data } = useSettings()
  const save = useSaveSettings((settings) => {
    setValue('')
    toast.success(t(settings.has_hf_token ? 'settings.hfToken.saved' : 'settings.hfToken.removed'))
  })
  return (
    <Box component="section" sx={{ border: '1px solid var(--line)', borderRadius: '16px', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: '4px', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
        <KeyOutlined sx={{ fontSize: 16, color: 'var(--muted)' }} />
        {t('settings.hfToken.title')}
        <Box component="span" sx={{ fontWeight: 400, color: 'var(--faint)' }}>
          {t('settings.hfToken.optional')}
        </Box>
        <InfoTip {...SETTINGS_HELP.hfToken} />
      </Box>
      <Box component="p" sx={{ m: 0, mb: '10px', fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>
        {t('settings.hfToken.description')}
        {data?.has_hf_token && <Box component="span" sx={{ color: 'var(--ok)' }}> {t('settings.hfToken.present')}</Box>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          type="password"
          size="small"
          fullWidth
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('settings.hfToken.placeholder')}
          autoComplete="off"
          slotProps={{ htmlInput: { 'aria-label': t('settings.hfToken.aria'), style: { fontFamily: 'var(--font-mono)' } } }}
        />
        <Button variant="outlined" disabled={!value.trim() || save.isPending} onClick={() => save.mutate({ hf_token: value })}>
          {t('settings.hfToken.save')}
        </Button>
        {data?.has_hf_token && (
          <Button variant="text" disabled={save.isPending} onClick={() => save.mutate({ hf_token: '' })}>
            {t('settings.hfToken.remove')}
          </Button>
        )}
      </Box>
    </Box>
  )
}
