/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Slider, Switch } from '@mui/material'
import { formatGb, useSystemInfo } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { SETTINGS_HELP } from '../lib/settingsConfig'
import { autoLimitGb, effectiveLimitGb, limitBounds } from '../lib/memoryLimit'
import { SectionText, SectionTitle } from './SettingsSection'

/**
 * Ceiling for the memory the models loaded together may take (chat, OCR, generation). Automatic: 80 % of the machine; otherwise
 * a slider from 4 GB to what the safety reserve leaves. Shows the models held now and what they take.
 */
export function MemoryLimitField() {
  const t = useT()
  const lang = useLang()
  const { data: settings } = useSettings()
  const { data: system } = useSystemInfo({ pollMs: 5_000 })
  const save = useSaveSettings()
  const [draft, setDraft] = useState<number | null>(null)
  if (!settings || !system) return null

  const { min, max } = limitBounds(system.ram_gb)
  const automatic = settings.memory_limit_gb <= 0
  const value = draft ?? Math.min(max, Math.max(min, effectiveLimitGb(settings.memory_limit_gb, system.ram_gb)))
  const held = system.memory.models

  return (
    <Box component="section">
      <SectionTitle title={t('settings.memoryLimit.title')} help={SETTINGS_HELP.memoryLimit} />
      <Box sx={{ mb: 1.5 }}>
        <SectionText>{t('settings.memoryLimit.description')}</SectionText>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Switch
          checked={automatic}
          onChange={(_event, auto) => save.mutate({ memory_limit_gb: auto ? 0 : Math.round(value) })}
          slotProps={{ input: { 'aria-label': t('settings.memoryLimit.auto', [formatGb(autoLimitGb(system.ram_gb), lang)]) } }}
        />
        <Box sx={{ fontSize: 13, color: 'var(--ink-2)' }}>{t('settings.memoryLimit.auto', [formatGb(autoLimitGb(system.ram_gb), lang)])}</Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, opacity: automatic ? 0.45 : 1 }}>
        <Slider
          value={value}
          min={min}
          max={max}
          step={1}
          disabled={automatic}
          onChange={(_event, next) => setDraft(next as number)}
          onChangeCommitted={(_event, next) => {
            setDraft(null)
            save.mutate({ memory_limit_gb: next as number })
          }}
          aria-label={t('settings.memoryLimit.aria')}
        />
        <Box sx={{ minWidth: 64, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{t('settings.memoryLimit.value', [formatGb(value, lang)])}</Box>
      </Box>
      <Box sx={{ mt: 0.5, fontSize: 12.5, color: 'var(--muted)' }}>
        {held.length === 0
          ? t('settings.memoryLimit.none')
          : t('settings.memoryLimit.held', [formatGb(system.memory.used_gb, lang), held.map((m) => m.name).join(', ')])}
      </Box>
    </Box>
  )
}
