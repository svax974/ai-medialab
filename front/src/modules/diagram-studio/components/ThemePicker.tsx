/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { ButtonBase, Menu, MenuItem } from '@mui/material'
import PaletteOutlined from '@mui/icons-material/PaletteOutlined'
import { LabelTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { DIAGRAM_THEMES, type DiagramTheme } from '../types'

/** Visual preset applied when the Mermaid source is rendered (client-side only, never sent to the model): picking a
 * different theme later just re-renders the same stored source, no new generation needed. */
export function ThemePicker({ value, onChange }: { value: DiagramTheme; onChange: (theme: DiagramTheme) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <LabelTooltip label={t('diagramStudio.theme.tip')}>
        <ButtonBase
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          sx={{ display: 'flex', height: 32, gap: '6px', borderRadius: '8px', border: '1px solid', borderColor: anchor ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: anchor ? 'var(--ink)' : 'var(--ink-2)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}
        >
          <PaletteOutlined sx={{ fontSize: 14 }} />
          <span>{t(`diagramStudio.theme.${value}`)}</span>
        </ButtonBase>
      </LabelTooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        {DIAGRAM_THEMES.map((theme) => (
          <MenuItem key={theme} selected={theme === value} onClick={() => { onChange(theme); setAnchor(null) }}>
            {t(`diagramStudio.theme.${theme}`)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
