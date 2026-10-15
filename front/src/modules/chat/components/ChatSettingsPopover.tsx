/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Badge, Box, Button, MenuItem, Popover, TextField } from '@mui/material'
import CasinoOutlined from '@mui/icons-material/CasinoOutlined'
import RestartAltRounded from '@mui/icons-material/RestartAltRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { SchemaParamsForm } from '@/modules_shared/common/components/ui/schemaform'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { activePreset, applyChange, PARAMS_SCHEMA, PRESET_IDS, reasoningChoices, SAMPLING_PRESETS, schemaValues } from '../lib/presets'
import type { ChatSettings, ChatSettingsPatch, LlmStatus } from '../types'
import { ContextField } from './ContextField'

interface Props {
  settings: ChatSettings
  model: ModelInfo | undefined
  status: LlmStatus | null
  onChange: (patch: ChatSettingsPatch) => void
}

function SeedField({ seed, onSeed }: { seed: number | null | undefined; onSeed: (seed: number | null) => void }) {
  const t = useT()
  return (
    <Box>
      <Box sx={{ mb: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-2)' }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{t('thread.seed.label')} <InfoTip titleId="chat.params.seed" bodyId="chat.params.seed.help" /></Box>
        <Box component="span" sx={{ fontSize: 11, color: 'var(--faint)' }}>{seed == null ? t('thread.seed.random') : t('thread.seed.fixed')}</Box>
      </Box>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        <Box component="input" type="number" min={0} placeholder={t('thread.seed.placeholder')} aria-label={t('thread.seed.label')} value={seed ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onSeed(event.target.value === '' ? null : Math.max(0, Math.floor(Number(event.target.value))))} sx={{ height: 36, minWidth: 0, flex: 1, borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.25, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink)', '&::placeholder': { color: 'var(--faint)' }, '&:focus': { borderColor: 'var(--line-strong)', outline: 'none' } }} />
        <TipIconButton labelId="thread.seed.draw" tone="default" onClick={() => onSeed(Math.floor(Math.random() * 2 ** 31))} sx={{ width: 36, height: 36, border: '1px solid var(--line)', backgroundColor: 'var(--surface)' }}>
          <CasinoOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
    </Box>
  )
}

function ReasoningSelect({ model, value, onChange }: { model: ModelInfo | undefined; value: ChatSettings['reasoning']; onChange: (value: ChatSettings['reasoning']) => void }) {
  const t = useT()
  const choices = reasoningChoices(model?.llm)
  if (choices.length < 2) return null
  return (
    <Box>
      <Box sx={{ mb: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 12.5, color: 'var(--ink-2)' }}>{t('chat.params.reasoning')} <InfoTip titleId="chat.params.reasoning" bodyId="chat.params.reasoning.help" /></Box>
      <TextField select size="small" fullWidth value={choices.includes(value) ? value : 'auto'} onChange={(event) => onChange(event.target.value as ChatSettings['reasoning'])} slotProps={{ htmlInput: { 'aria-label': t('chat.params.reasoning') } }}>
        {choices.map((id) => <MenuItem key={id} value={id}>{t(`chat.reasoning.level.${id}`)}</MenuItem>)}
      </TextField>
    </Box>
  )
}

/**
 * The settings of the conversation: precise / balanced / creative presets, the sampling parameters (sliders, the rare
 * ones folded), the thinking level when the model offers it, the seed and the context (with the notice that changing it
 * reloads the model). Saved per conversation; "Default values" resets them all.
 */
export function ChatSettingsPopover({ settings, model, status, onChange }: Props) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const preset = activePreset(settings.params)
  const modified = Object.keys(settings.params).length > 0 || settings.context_size !== null || settings.reasoning !== 'auto'
  return (
    <>
      <TipIconButton labelId="chat.params.tip" tone="default" active={!!anchor} onClick={(event) => setAnchor(event.currentTarget)}>
        <Badge color="primary" variant="dot" invisible={!modified}>
          <TuneRounded sx={{ fontSize: 16 }} />
        </Badge>
      </TipIconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 120px)', p: 2 } } }}>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box className="cn-eyebrow">{t('chat.params.title')}</Box>
            <Button size="small" color="inherit" startIcon={<RestartAltRounded />} onClick={() => onChange({ params: {}, context_size: null, reasoning: 'auto' })}>{t('chat.params.reset')}</Button>
          </Box>
          <Box role="group" aria-label={t('chat.params.presets')} sx={{ display: 'flex', gap: '6px' }}>
            {PRESET_IDS.map((id) => (
              <Button key={id} size="small" fullWidth variant={preset === id ? 'contained' : 'outlined'} color="inherit" aria-pressed={preset === id} onClick={() => onChange({ params: { ...SAMPLING_PRESETS[id], seed: settings.params.seed, stop: settings.params.stop } })}>{t(`chat.preset.${id}`)}</Button>
            ))}
          </Box>
          <SchemaParamsForm schema={PARAMS_SCHEMA} values={schemaValues(settings.params)} onChange={(patch) => onChange({ params: applyChange(settings.params, patch) })}>
            <ReasoningSelect model={model} value={settings.reasoning} onChange={(reasoning) => onChange({ reasoning })} />
            <SeedField seed={settings.params.seed} onSeed={(seed) => onChange({ params: { ...settings.params, seed } })} />
            <ContextField value={settings.context_size} caps={model?.llm} modelId={model?.id ?? null} status={status} onChange={(context_size) => onChange({ context_size })} />
          </SchemaParamsForm>
        </Box>
      </Popover>
    </>
  )
}
