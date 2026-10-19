/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { formatGb } from '@/modules/hardware'
import { useSaveSettings } from '@/modules/settings'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { MODEL_HELP } from '../lib/modelHelp'
import type { ModelInfo } from '../types'

const chipSx = (selected: boolean) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  px: 1,
  py: '4px',
  borderRadius: '8px',
  border: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  color: selected ? 'var(--ink)' : 'var(--muted)',
  backgroundColor: selected ? 'var(--safe-soft)' : 'var(--surface)',
  boxShadow: selected ? 'inset 0 0 0 1px color-mix(in oklab, var(--safe) 50%, transparent)' : 'inset 0 0 0 1px var(--line)',
  '&:hover': { color: 'var(--ink)' },
  '&:disabled': { opacity: 0.6, cursor: 'default' },
})

/** Quantization choice: downloading one keeps it installed; the setting only picks which is used to generate. */
export function VariantPicker({ model, disabled }: { model: ModelInfo; disabled?: boolean }) {
  const t = useT()
  const lang = useLang()
  const save = useSaveSettings()
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: '6px' }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 11.5, color: 'var(--muted)' }}>
          {t('models.variant.label')} <InfoTip {...MODEL_HELP.variant} />
        </Box>
        <Box component="span" sx={{ fontSize: 11, color: 'var(--faint)' }}>
          {t('models.variant.onlyChosen')}
        </Box>
      </Box>
      <Box role="group" aria-label={t('models.variant.label')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {model.variants.map((v) => (
          <Box
            component="button"
            type="button"
            key={v.key}
            disabled={save.isPending || disabled}
            aria-pressed={v.selected}
            onClick={() => !v.selected && save.mutate({ variant: { [model.id]: v.key } })}
            title={v.install === 'installed' ? t('models.variant.installed') : v.temp_gb > 0 ? t('models.variant.toDownloadTemp', [formatGb(v.need_gb, lang), formatGb(v.temp_gb, lang), formatGb(v.size_gb, lang)]) : t('models.variant.toDownload', [formatGb(v.need_gb, lang)])}
            sx={chipSx(v.selected)}
          >
            {v.install === 'installed' && <CheckRounded sx={{ fontSize: 12, color: 'var(--ok)' }} />}
            {v.label}
            <Box component="span" sx={{ color: 'var(--faint)' }}>
              {t('models.size.gb', [formatGb(v.size_gb, lang)])}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
