/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Tab, Tabs } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { homePathForMode } from '../lib/routes'
import { useT } from '../hooks/useT'
import { useStudioStore } from '../state/studioStore'
import { STUDIO_MODES, type StudioMode } from '../types'
import { ModeIcon } from './modeIcons'

const MODE_LABELS: Record<StudioMode, string> = {
  image: 'studio.mode.image',
  audio: 'studio.mode.audio',
  video: 'studio.mode.video',
  chat: 'studio.mode.chat',
  diagram: 'studio.mode.diagram',
}

/**
 * Five tabs share the sidebar (≈ 51 px each): icon above label, and no MUI `minWidth` (90 px), which pushed the last tab out of
 * the clipped row.
 */
const TAB_SX = {
  minWidth: 0,
  px: 0.5,
  '&.MuiTab-labelIcon': { flexDirection: 'column', gap: '2px', height: 44, minHeight: 44, fontSize: 12 },
} as const

/** Image / audio / video / chat switch: a segmented control whose pill slides (Tabs indicator, see the theme). */
export function ModeSwitch() {
  const t = useT()
  const navigate = useNavigate()
  const mode = useStudioStore((s) => s.mode)
  const setMode = useStudioStore((s) => s.setMode)
  const lastPathByMode = useStudioStore((s) => s.lastPathByMode)

  const go = (target: StudioMode) => {
    if (target === mode) return
    setMode(target)
    navigate(lastPathByMode[target] ?? homePathForMode(target))
  }

  return (
    <Box sx={{ px: 1.5, pb: 1.5, pt: '2px' }}>
      <Tabs value={mode} onChange={(_event, value: StudioMode) => go(value)} aria-label={t('studio.mode.aria')}>
        {STUDIO_MODES.map((id) => (
          <Tab key={id} value={id} icon={<ModeIcon mode={id} />} iconPosition="top" label={t(MODE_LABELS[id])} sx={TAB_SX} />
        ))}
      </Tabs>
    </Box>
  )
}
