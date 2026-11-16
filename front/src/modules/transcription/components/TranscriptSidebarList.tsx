/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Box, ButtonBase, CircularProgress, TableSortLabel } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import { useSortableTable } from '@/modules_shared/common/hooks/useSortableTable'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useTranscripts } from '../hooks/useTranscripts'
import { isTranscriptActive } from '../lib/transcriptRules'
import type { Transcript } from '../types'

const COLUMNS = [{ key: 'title' as const }, { key: 'created_at' as const }]
interface Props { query: string }

export function TranscriptSidebarList({ query }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams()
  const { data = [], loading, error } = useTranscripts(query)
  const { sortedItems, sortConfig, handleSort } = useSortableTable<Transcript, 'title' | 'created_at'>(data, COLUMNS, { field: 'created_at', direction: 'desc' })
  return (
    <Box component="nav" aria-label={t('transcription.history')} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 1, py: 1, fontSize: 11, color: 'var(--faint)' }}>
        {COLUMNS.map(({ key }) => <TableSortLabel key={key} active={sortConfig.field === key} direction={sortConfig.direction} onClick={() => handleSort(key)}>{t(key === 'title' ? 'transcription.title' : 'transcription.date')}</TableSortLabel>)}
      </Box>
      {loading && <Box sx={{ p: 2 }}><CircularProgress size={16} /></Box>}
      {error ? <Box sx={{ p: 1, color: 'var(--danger)', fontSize: 12 }}>{t('transcription.error.history')}</Box> : null}
      {!loading && !sortedItems.length && <Box sx={{ p: 2, color: 'var(--faint)', fontSize: 13 }}>{t(query ? 'transcription.noMatch' : 'transcription.emptyHistory')}</Box>}
      {sortedItems.map((row) => <ButtonBase key={row.id} onClick={() => navigate(`/transcriptions/${row.id}`)} aria-current={row.id === id ? 'page' : undefined} sx={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start', px: 1.25, py: 1, gap: 1, borderRadius: '10px', bgcolor: row.id === id ? 'var(--surface-2)' : undefined }}>
        {isTranscriptActive(row.status) && <CircularProgress size={12} color="inherit" />}
        <Box sx={{ minWidth: 0 }}><Box sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</Box><Box sx={{ fontSize: 11, color: 'var(--faint)' }}>{t(`transcription.stage.${row.stage}`)}</Box></Box>
      </ButtonBase>)}
    </Box>
  )
}
