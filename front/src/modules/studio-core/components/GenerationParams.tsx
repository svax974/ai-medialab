/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'react'
import { Box } from '@mui/material'
import CasinoOutlined from '@mui/icons-material/CasinoOutlined'
import LockRounded from '@mui/icons-material/LockRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { SchemaParamsPopover } from '@/modules_shared/common/components/ui/schemaform'
import type { ParamValue } from '@/modules_shared/common/components/ui/schemaform'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { PARAM_HELP } from '../lib/paramHelp'
import { isFullReset, paramValues, toParamsSchema } from '../lib/paramsSchema'
import type { GenParams } from '../types'

interface Props {
  model: ModelInfo
  params: GenParams
  hasRefs: boolean
  seed: number | null
  onChange: (patch: GenParams) => void
  onReset: () => void
  onSeed: (seed: number | null) => void
}

function SeedField({ seed, onSeed }: { seed: number | null; onSeed: (seed: number | null) => void }) {
  const t = useT()
  return (
    <Box>
      <Box sx={{ mb: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ink-2)' }}>
          {t('thread.seed.label')} <InfoTip {...PARAM_HELP['seed']} />
        </Box>
        <Box component="span" sx={{ fontSize: 11, color: 'var(--faint)' }}>{seed === null ? t('thread.seed.random') : t('thread.seed.fixed')}</Box>
      </Box>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        <Box
          component="input"
          type="number"
          min={0}
          placeholder={t('thread.seed.placeholder')}
          aria-label={t('thread.seed.label')}
          value={seed ?? ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onSeed(event.target.value === '' ? null : Math.max(0, Math.floor(Number(event.target.value))))}
          sx={{ height: 36, minWidth: 0, flex: 1, borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.25, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink)', '&::placeholder': { color: 'var(--faint)' }, '&:focus': { borderColor: 'var(--line-strong)', outline: 'none' } }}
        />
        <TipIconButton labelId="thread.seed.draw" tone="default" onClick={() => onSeed(Math.floor(Math.random() * 2 ** 31))} sx={{ width: 36, height: 36, border: '1px solid var(--line)', backgroundColor: 'var(--surface)' }}>
          <CasinoOutlined sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
    </Box>
  )
}

/**
 * Generation settings of the model, generated from its parameter list (`SchemaParamsPopover`): sliders, switches and text
 * with their "?" tooltips, advanced ones folded, plus the seed. The button shows the step count, a lock when the seed is
 * pinned and a dot (common component) when a value differs from its default. "Default values" also frees the seed.
 */
export function GenerationParams({ model, params, hasRefs, seed, onChange, onReset, onSeed }: Props) {
  const t = useT()
  const schema = useMemo(() => toParamsSchema(model, hasRefs, t), [model, hasRefs, t])
  const change = (patch: Record<string, ParamValue>) => {
    if (isFullReset(schema, patch)) {
      onReset()
      onSeed(null)
    } else onChange(patch)
  }
  return (
    <SchemaParamsPopover
      schema={schema}
      values={paramValues(params, schema)}
      onChange={change}
      titleId="thread.params.title"
      triggerLabelId="thread.params.tip"
      icon={
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <TuneRounded sx={{ fontSize: 14 }} />
          {model.kind === 'image' ? (
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline' }, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t('thread.params.steps', [params.steps ?? '—'])}</Box>
          ) : (
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline' }, fontSize: 13 }}>{t('thread.params.label')}</Box>
          )}
          {seed !== null && <LockRounded sx={{ fontSize: 12, color: 'var(--safe)' }} />}
        </Box>
      }
    >
      <SeedField seed={seed} onSeed={onSeed} />
    </SchemaParamsPopover>
  )
}
