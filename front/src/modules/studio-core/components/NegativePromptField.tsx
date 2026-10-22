/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { NEGATIVE_PROMPT } from '../lib/paramsSchema'
import { LabelTooltip } from './HelpTooltip'

interface NegativePromptFieldProps {
  model: Pick<ModelInfo, 'params'>
  value: string
  onChange: (value: string) => void
  /** Enter sends, as in the prompt above. */
  onSubmit: () => void
}

/**
 * "To avoid" line under the prompt of a composer, for models that take a negative prompt (it is then left out of the
 * settings panel): smaller, with a "no entry" sign and a red edge so that it never reads as the prompt itself.
 */
export function NegativePromptField({ model, value, onChange, onSubmit }: NegativePromptFieldProps) {
  const t = useT()
  if (!model.params.some((p) => p.key === NEGATIVE_PROMPT)) return null
  return (
    <Box sx={{ mx: 1.75, mb: '6px', display: 'flex', alignItems: 'center', gap: 1, borderRadius: '10px', borderLeft: '2px solid color-mix(in oklab, var(--danger) 55%, transparent)', backgroundColor: 'var(--surface-2)', px: 1.25, py: '6px' }}>
      <LabelTooltip label={t('thread.negative.tip')}>
        <DoNotDisturbOnOutlined sx={{ fontSize: 15, flexShrink: 0, color: 'color-mix(in oklab, var(--danger) 70%, var(--muted))' }} />
      </LabelTooltip>
      <Box
        component="input"
        type="text"
        value={value}
        aria-label={t('thread.negative.aria')}
        placeholder={t('thread.negative.placeholder')}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit()
          }
        }}
        sx={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink-2)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }}
      />
    </Box>
  )
}
