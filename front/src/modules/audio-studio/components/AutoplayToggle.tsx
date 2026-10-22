/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded'
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded'
import { ButtonBase } from '@mui/material'
import { HelpTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { autoplayHelp } from '../lib/audioHelp'

/** Autoplay of a take that was just generated: a speaker button whose tooltip says whether it is on. */
export function AutoplayToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const t = useT()
  return (
    <HelpTooltip help={autoplayHelp(enabled, t)}>
      <ButtonBase onClick={() => onChange(!enabled)} aria-label={t('audioStudio.autoplay.aria')} aria-pressed={enabled} sx={{ display: 'grid', width: 32, height: 32, placeItems: 'center', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', color: enabled ? 'var(--ink-2)' : 'var(--faint)', '&:hover': { borderColor: 'var(--line-strong)' } }}>
        {enabled ? <VolumeUpRounded sx={{ fontSize: 14 }} /> : <VolumeOffRounded sx={{ fontSize: 14 }} />}
      </ButtonBase>
    </HelpTooltip>
  )
}
