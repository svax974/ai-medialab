/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Badge, Box, Button, Chip, Popover } from '@mui/material'
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { PERSONA_IDS } from '../lib/presets'

interface Props {
  value: string
  onChange: (value: string) => void
}

/** The system prompt of the conversation: a text and ready-made personas (a click fills the text; the text stays editable). */
export function SystemPromptPopover({ value, onChange }: Props) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const active = PERSONA_IDS.find((id) => t(`chat.persona.${id}.prompt`) === value)
  return (
    <>
      <TipIconButton labelId="chat.system.tip" tone="default" active={!!anchor} onClick={(event) => setAnchor(event.currentTarget)}>
        <Badge color="primary" variant="dot" invisible={value.trim() === ''}>
          <SmartToyOutlined sx={{ fontSize: 16 }} />
        </Badge>
      </TipIconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 400, maxWidth: 'calc(100vw - 24px)', p: 2 } } }}>
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box className="cn-eyebrow">{t('chat.system.title')}</Box>
            <Button size="small" color="inherit" disabled={value === ''} onClick={() => onChange('')}>{t('chat.system.clear')}</Button>
          </Box>
          <Box role="group" aria-label={t('chat.system.personas')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {PERSONA_IDS.map((id) => (
              <Chip key={id} size="small" clickable label={t(`chat.persona.${id}`)} color={active === id ? 'primary' : 'default'} onClick={() => onChange(t(`chat.persona.${id}.prompt`))} />
            ))}
          </Box>
          <Box
            component="textarea"
            rows={6}
            value={value}
            aria-label={t('chat.system.title')}
            placeholder={t('chat.system.placeholder')}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
            sx={{ width: '100%', resize: 'vertical', borderRadius: '10px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', p: 1.25, fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', outline: 'none', '&:focus': { borderColor: 'var(--line-strong)' }, '&::placeholder': { color: 'var(--faint)' } }}
          />
          <Box component="p" sx={{ m: 0, fontSize: 11.5, lineHeight: 1.4, color: 'var(--faint)' }}>{t('chat.system.hint')}</Box>
        </Box>
      </Popover>
    </>
  )
}
