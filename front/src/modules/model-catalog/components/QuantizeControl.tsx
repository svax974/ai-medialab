/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { useSaveSettings } from '@/modules/settings'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { quantizeChoices } from '../lib/catalogFormat'
import { MODEL_HELP } from '../lib/modelHelp'
import type { ModelInfo } from '../types'

/** Weight precision of an installed MLX model (4, 6, 8 bits or bf16), saved as the `quantize` setting. */
export function QuantizeControl({ model }: { model: ModelInfo }) {
  const t = useT()
  const save = useSaveSettings()
  return (
    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 11.5, color: 'var(--faint)' }}>
        {t('models.quantize.label')} <InfoTip {...MODEL_HELP.quantize} side="left" />
      </Box>
      <Box role="group" aria-label={t('models.quantize.label')} sx={{ display: 'flex', p: '2px', borderRadius: '8px', backgroundColor: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        {quantizeChoices(model.quantize_options).map((q) => (
          <Box
            component="button"
            type="button"
            key={String(q)}
            aria-pressed={model.quantize === q}
            disabled={save.isPending}
            onClick={() => save.mutate({ quantize: { [model.id]: q } })}
            sx={{ border: 0, cursor: 'pointer', px: 1, py: '4px', borderRadius: '6px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: model.quantize === q ? 'var(--ink)' : 'var(--faint)', backgroundColor: model.quantize === q ? 'var(--surface-3)' : 'transparent', '&:hover': { color: 'var(--ink)' } }}
          >
            {q ? t('models.quantize.bits', [q]) : t('models.quantize.bf16')}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
