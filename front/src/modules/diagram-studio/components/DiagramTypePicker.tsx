/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, Menu, MenuItem } from '@mui/material'
import SchemaOutlined from '@mui/icons-material/SchemaOutlined'
import { LabelTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { DIAGRAM_TYPES, type DiagramType } from '../types'

/** Kind of diagram to produce (flowchart, org chart, architecture, state, mindmap, sequence): picks the system prompt
 * and the Mermaid syntax the back converts the model's structured answer into (`back/src/modules/diagrams/lib/toMermaid.ts`). */
export function DiagramTypePicker({ value, onChange }: { value: DiagramType; onChange: (diagramType: DiagramType) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <LabelTooltip label={t('diagramStudio.type.tip')}>
        <ButtonBase
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          sx={{ display: 'flex', height: 32, gap: '6px', borderRadius: '8px', border: '1px solid', borderColor: anchor ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: anchor ? 'var(--ink)' : 'var(--ink-2)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}
        >
          <SchemaOutlined sx={{ fontSize: 14 }} />
          <span>{t(`diagramStudio.type.${value}`)}</span>
        </ButtonBase>
      </LabelTooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        {DIAGRAM_TYPES.map((type) => (
          <MenuItem key={type} selected={type === value} onClick={() => { onChange(type); setAnchor(null) }}>
            <Box sx={{ display: 'grid' }}>
              <Box component="span">{t(`diagramStudio.type.${type}`)}</Box>
              <Box component="span" sx={{ fontSize: 11.5, color: 'var(--faint)' }}>{t(`diagramStudio.type.${type}.hint`)}</Box>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
