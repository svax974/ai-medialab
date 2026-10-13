/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { formatGb, type SystemInfo } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useSizeLabel } from '../hooks/useSizeLabel'
import { backendLabel } from '../lib/catalogFormat'
import { MODEL_HELP } from '../lib/modelHelp'
import type { ModelInfo } from '../types'
import { HelpTag } from './ModelBadges'
import { Tag } from './panels'

type SystemEngines = { engines?: Record<string, { device?: string }> } & Pick<SystemInfo, 'accelerators'>

/** Title line of a model card: name, engine, precision, size, origin, speed warning, loaded and install state. */
export function ModelHeader({ model: m, system, loaded, downloading }: { model: ModelInfo; system?: SystemEngines; loaded: boolean; downloading: boolean }) {
  const t = useT()
  const lang = useLang()
  const sizeLabel = useSizeLabel()
  const backend = backendLabel(m, { sdcppDevice: system?.engines?.sdcpp?.device, torchDevice: system?.engines?.torch?.device, accelerators: system?.accelerators })
  const size = sizeLabel(m.download_size_gb)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px' }}>
      <Box component="h3" sx={{ m: 0, fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
        {m.name}
      </Box>
      <Tag>{t(backend.key, backend.params)}</Tag>
      {m.precision && <HelpTag help={MODEL_HELP.quantize} size="md">{m.precision}</HelpTag>}
      {size && (
        <Tag tone="strong" title={t('models.size.title')}>
          {size}
        </Tag>
      )}
      {m.custom && <Tag tone="soft">{t('models.custom.badge')}</Tag>}
      {m.plan.degraded && (
        <Tag tone="warn" pill title={m.plan.note}>
          {t('models.slow.badge')}
        </Tag>
      )}
      {loaded && (
        <Tag tone="ok" pill>
          {t('models.loaded')}
        </Tag>
      )}
      {m.install === 'installed' && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color: 'var(--ok)' }}>
          <CheckRounded sx={{ fontSize: 12 }} />
          {t('models.installed', [formatGb(m.installed_gb, lang)])}
        </Box>
      )}
      {m.install === 'partial' && !downloading && (
        <Box component="span" sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color: 'var(--warn)' }}>
          {t('models.partial', [formatGb(m.installed_gb, lang)])}
        </Box>
      )}
    </Box>
  )
}
