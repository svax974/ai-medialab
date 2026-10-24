/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress } from '@mui/material'
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import { useNavigate, useParams } from 'react-router-dom'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useOcrDocuments } from '../hooks/useOcr'
import { isActiveStatus } from '../lib/ocrRules'
import type { OcrDocument } from '../types'

function StatusIcon({ doc }: { doc: OcrDocument }) {
  if (isActiveStatus(doc.status)) return <CircularProgress size={13} color="inherit" />
  if (doc.status === 'done') return <CheckCircleOutlineRounded sx={{ fontSize: 15, color: 'var(--safe)' }} />
  return <ErrorOutlineRounded sx={{ fontSize: 15, color: doc.status === 'failed' ? 'var(--danger)' : 'var(--faint)' }} />
}

/** The readings in the sidebar of the OCR mode (newest first, filtered by the search field). */
export function OcrSidebarList({ query }: { query: string }) {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams()
  const { data: docs = [], isPending } = useOcrDocuments(query)
  return (
    <Box component="nav" aria-label={t('ocrStudio.list.aria')} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
      {isPending && <Box sx={{ p: 2, textAlign: 'center' }}><CircularProgress size={16} color="inherit" /></Box>}
      {!isPending && docs.length === 0 && <Box sx={{ p: 2, fontSize: 13, color: 'var(--faint)' }}>{query ? t('ocrStudio.list.noMatch') : t('ocrStudio.list.empty')}</Box>}
      {docs.map((doc) => (
        <Box
          key={doc.id}
          component="button"
          type="button"
          onClick={() => navigate(studioPaths.ocrDocument(doc.id))}
          aria-current={doc.id === id ? 'page' : undefined}
          sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1.25, border: 0, borderRadius: '10px', background: doc.id === id ? 'var(--surface-2)' : 'transparent', px: 1.25, py: '8px', textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', '&:hover': { background: 'var(--surface-2)' } }}
        >
          <StatusIcon doc={doc} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5 }}>{doc.title}</Box>
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--faint)' }}>
              {t('ocrStudio.list.meta', [doc.model_name, doc.document_pages > 0 ? doc.document_pages : '…'])}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
