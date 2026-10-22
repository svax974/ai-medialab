/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import ChecklistRounded from '@mui/icons-material/ChecklistRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { useT } from '../hooks/useT'

interface SelectionBarProps {
  selecting: boolean
  /** Ticked conversations that are still listed. */
  count: number
  /** Conversations listed. */
  total: number
  busy: boolean
  onStart: () => void
  onStop: () => void
  onToggleAll: () => void
  onDelete: () => void
}

/** Top of the conversation list: the « Select » entry, then in selection mode the count, select-all, delete and done. */
export function SelectionBar({ selecting, count, total, busy, onStart, onStop, onToggleAll, onDelete }: SelectionBarProps) {
  const t = useT()
  if (!selecting) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 0.5 }}>
        <Button size="small" startIcon={<ChecklistRounded sx={{ fontSize: 15 }} />} onClick={onStart} sx={{ color: 'var(--faint)', fontSize: 12 }}>
          {t('studio.select.start')}
        </Button>
      </Box>
    )
  }
  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', mb: 1, px: 1, py: '4px', borderRadius: '10px', backgroundColor: 'var(--bg-elev)', boxShadow: '0 0 0 1px var(--line)' }}>
      <Box role="status" sx={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>{t('studio.select.count', [count])}</Box>
      <Button size="small" onClick={onToggleAll} disabled={busy} sx={{ fontSize: 12 }}>
        {count === total ? t('studio.select.none') : t('studio.select.all')}
      </Button>
      <Button size="small" color="error" disabled={count === 0 || busy} onClick={onDelete} startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <DeleteOutlineRounded sx={{ fontSize: 15 }} />} sx={{ fontSize: 12 }}>
        {t('studio.select.delete')}
      </Button>
      <Button size="small" onClick={onStop} disabled={busy} sx={{ fontSize: 12 }}>
        {t('studio.select.cancel')}
      </Button>
    </Box>
  )
}
