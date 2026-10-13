/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, Menu, MenuItem } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import LanguageRounded from '@mui/icons-material/LanguageRounded'
import type { AudioCaps } from '@/modules/model-catalog'
import { HelpTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { AUDIO_HELP } from '../lib/audioHelp'

/** Language of the text (it sets the pronunciation and filters the voices); hidden when the model has only one. */
export function LanguagePicker({ caps, value, onChange }: { caps: AudioCaps; value: string; onChange: (code: string) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (caps.languages.length < 2) return null
  const current = caps.languages.find((language) => language.code === value) ?? caps.languages[0]
  return (
    <>
      <HelpTooltip help={AUDIO_HELP.language}>
        <ButtonBase onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="menu" sx={{ display: 'flex', height: 32, alignItems: 'center', gap: '6px', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: 'var(--ink-2)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}>
          <LanguageRounded sx={{ fontSize: 14 }} /><span>{current.label}</span><ExpandMoreRounded sx={{ fontSize: 14, opacity: 0.6 }} />
        </ButtonBase>
      </HelpTooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: -1, minWidth: 176 } } }}>
        <Box className="cn-eyebrow" sx={{ px: 1.25, pb: '4px', pt: '6px' }}>{t('audioStudio.language.title')}</Box>
        {caps.languages.map((language) => (
          <MenuItem key={language.code} selected={language.code === current.code} onClick={() => { onChange(language.code); setAnchor(null) }} sx={{ gap: 1 }}>
            <Box component="span" sx={{ display: 'grid', width: 16, placeItems: 'center' }}>{language.code === current.code && <CheckRounded sx={{ fontSize: 14, color: 'var(--safe)' }} />}</Box>
            {language.label}
            <Box component="span" sx={{ ml: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--faint)' }}>{language.code}</Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
