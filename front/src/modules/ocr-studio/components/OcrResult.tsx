/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useState } from 'react'
import { Box, Button, ButtonBase, CircularProgress, LinearProgress, Menu, MenuItem } from '@mui/material'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import ReplayRounded from '@mui/icons-material/ReplayRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { useNavigate } from 'react-router-dom'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useOcrActions, useOcrDocument } from '../hooks/useOcr'
import { isActiveStatus, joinPages, progressRatio } from '../lib/ocrRules'
import { ocrApi } from '../services/ocrApi'
import { OCR_EXPORT_FORMATS, type OcrDocumentDetail, type OcrExportFormat } from '../types'

function copy(text: string, done: string, failed: string): void {
  navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error(failed))
}

function ExportMenu({ doc }: { doc: OcrDocumentDetail }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const download = (format: OcrExportFormat) => {
    setAnchor(null)
    window.location.assign(ocrApi.exportUrl(doc.id, format))
  }
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<FileDownloadOutlined />} disabled={doc.pages_read.length === 0} onClick={(event) => setAnchor(event.currentTarget)}>
        {t('ocrStudio.result.export')}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {OCR_EXPORT_FORMATS.map((format) => (
          <MenuItem key={format} onClick={() => download(format)}>{t(`ocrStudio.export.${format}`)}</MenuItem>
        ))}
      </Menu>
    </>
  )
}

function Source({ doc }: { doc: OcrDocumentDetail }) {
  const t = useT()
  const url = ocrApi.sourceUrl(doc.id)
  return (
    <Box sx={{ minHeight: 0, overflow: 'auto', borderRadius: '14px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)' }}>
      {doc.source_kind === 'image' ? (
        <Box component="img" src={url} alt={t('ocrStudio.result.sourceAlt', [doc.title])} sx={{ display: 'block', width: '100%', height: 'auto' }} />
      ) : (
        <Box component="iframe" src={url} title={t('ocrStudio.result.sourceAlt', [doc.title])} sx={{ display: 'block', width: '100%', height: '100%', minHeight: 420, border: 0 }} />
      )}
    </Box>
  )
}

function PageText({ doc, index }: { doc: OcrDocumentDetail; index: number }) {
  const t = useT()
  const page = doc.pages_read.find((p) => p.index === index)
  if (!page) {
    return <Box sx={{ p: 2, fontSize: 13, color: 'var(--muted)' }}>{isActiveStatus(doc.status) ? t('ocrStudio.result.pageWaiting') : t('ocrStudio.result.pageMissing')}</Box>
  }
  return (
    <Box sx={{ position: 'relative', height: '100%', overflow: 'auto' }}>
      {page.truncated && <Box role="status" sx={{ m: 1.5, borderRadius: '10px', backgroundColor: 'color-mix(in oklab, var(--warn) 12%, transparent)', px: 1.5, py: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>{t('ocrStudio.result.truncated')}</Box>}
      <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', p: 2, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>{page.text || t('ocrStudio.result.emptyPage')}</Box>
      <ButtonBase aria-label={t('ocrStudio.result.copyPage')} onClick={() => copy(page.text, t('ocrStudio.result.copied'), t('ocrStudio.result.copyFailed'))} sx={{ position: 'absolute', right: 8, top: 8, borderRadius: '8px', p: '6px', color: 'var(--muted)', backgroundColor: 'var(--surface-2)', '&:hover': { color: 'var(--ink)' } }}>
        <ContentCopyRounded sx={{ fontSize: 15 }} />
      </ButtonBase>
    </Box>
  )
}

/** Pages of the reading: those asked for, or all of the document (the ones not read yet are greyed). */
function pageNumbers(doc: OcrDocumentDetail): number[] {
  const wanted = doc.pages ?? Array.from({ length: Math.max(doc.document_pages, doc.pages_read.length) }, (_, i) => i + 1)
  return [...new Set([...wanted, ...doc.pages_read.map((p) => p.index)])].sort((a, b) => a - b)
}

/** After a refusal for lack of free memory: asks to be sure, then runs the reading again without that check. */
function ContinueAnyway({ id }: { id: string }) {
  const t = useT()
  const { retry } = useOcrActions()
  const go = async () => {
    const ok = await confirm({ titleId: 'thread.forceMemory.title', messageId: 'thread.forceMemory.description', confirmLabelId: 'thread.forceMemory.confirm', danger: true })
    if (ok) retry.mutate({ id, change: { forceMemory: true } })
  }
  return <Button size="small" variant="outlined" color="warning" disabled={retry.isPending} onClick={() => void go()}>{t('thread.forceMemory.button')}</Button>
}

function Header({ doc }: { doc: OcrDocumentDetail }) {
  const t = useT()
  const navigate = useNavigate()
  const { cancel, retry, remove } = useOcrActions()
  const active = isActiveStatus(doc.status)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box component="h1" sx={{ m: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 26, color: 'var(--ink)' }}>{doc.title}</Box>
        <Box sx={{ mt: '2px', fontSize: 12.5, color: 'var(--muted)' }}>
          {t('ocrStudio.result.meta', [doc.model_name, t(`ocrStudio.task.${doc.task}`), t(`ocrStudio.status.${doc.status}`)])}
        </Box>
      </Box>
      {active ? (
        <Button size="small" variant="outlined" startIcon={cancel.isPending ? <CircularProgress size={14} /> : <StopRounded />} onClick={() => cancel.mutate(doc.id)}>{t('ocrStudio.result.cancel')}</Button>
      ) : (
        <Button size="small" variant="outlined" startIcon={<ReplayRounded />} disabled={retry.isPending} onClick={() => retry.mutate({ id: doc.id })}>{t('ocrStudio.result.retry')}</Button>
      )}
      <Button size="small" variant="outlined" startIcon={<ContentCopyRounded />} disabled={doc.pages_read.length === 0} onClick={() => copy(joinPages(doc.pages_read), t('ocrStudio.result.copied'), t('ocrStudio.result.copyFailed'))}>{t('ocrStudio.result.copyAll')}</Button>
      <ExportMenu doc={doc} />
      <ButtonBase aria-label={t('ocrStudio.result.delete')} title={t('ocrStudio.result.delete')} onClick={() => remove.mutate(doc.id, { onSuccess: () => navigate(studioPaths.ocrHome) })} sx={{ borderRadius: '10px', p: '7px', color: 'var(--muted)', '&:hover': { color: 'var(--danger)' } }}>
        <DeleteOutlineRounded sx={{ fontSize: 18 }} />
      </ButtonBase>
    </Box>
  )
}

function Progress({ doc }: { doc: OcrDocumentDetail }) {
  const t = useT()
  if (!isActiveStatus(doc.status)) return null
  const waiting = doc.status === 'queued'
  return (
    <Box>
      <LinearProgress variant={waiting || doc.progress.total === 0 ? 'indeterminate' : 'determinate'} value={progressRatio(doc) * 100} sx={{ borderRadius: 4 }} />
      <Box sx={{ mt: '4px', fontSize: 12, color: 'var(--muted)' }}>
        {waiting ? t('ocrStudio.result.waiting') : doc.progress.total > 0 ? t('ocrStudio.result.progress', [doc.progress.done, doc.progress.total]) : t('ocrStudio.result.loading')}
      </Box>
    </Box>
  )
}

/** A reading: its state and progress, the original next to the text of the page chosen, copy and export. */
export function OcrResult({ id }: { id: string }) {
  const t = useT()
  const { data: doc, isError, isPending } = useOcrDocument(id)
  const [page, setPage] = useState<number | null>(null)
  const pages = useMemo(() => (doc ? pageNumbers(doc) : []), [doc])
  const current = page !== null && pages.includes(page) ? page : (pages[0] ?? 1)
  useEffect(() => setPage(null), [id])
  if (isPending) return <Box sx={{ display: 'grid', flex: 1, placeItems: 'center' }}><CircularProgress size={22} color="inherit" /></Box>
  if (isError || !doc) return <Box role="alert" sx={{ p: 4, color: 'var(--danger)' }}>{t('ocrStudio.result.notFound')}</Box>
  return (
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', gap: 1.5, p: { xs: 2, md: 3 } }}>
      <Header doc={doc} />
      <Progress doc={doc} />
      {doc.error && (
        <Box role="alert" sx={{ display: 'grid', gap: 1, justifyItems: 'start', borderRadius: '12px', border: '1px solid color-mix(in oklab, var(--danger) 40%, transparent)', px: 1.5, py: 1.25, fontSize: 13, color: 'var(--ink)' }}>
          {doc.error}
          {doc.error_code === 'memory' && <ContinueAnyway id={doc.id} />}
        </Box>
      )}
      {pages.length > 1 && (
        <Box role="tablist" aria-label={t('ocrStudio.result.pages')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {pages.map((n) => {
            const read = doc.pages_read.some((p) => p.index === n)
            return (
              <ButtonBase key={n} role="tab" aria-selected={n === current} onClick={() => setPage(n)} sx={{ minWidth: 34, borderRadius: '8px', px: 1, py: '4px', fontSize: 12.5, color: n === current ? 'var(--ink)' : read ? 'var(--ink-2)' : 'var(--faint)', backgroundColor: n === current ? 'var(--surface-3)' : 'transparent', '&:hover': { backgroundColor: 'var(--surface-2)' } }}>{n}</ButtonBase>
            )
          })}
        </Box>
      )}
      <Box sx={{ display: 'grid', minHeight: 0, flex: 1, gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gridTemplateRows: { xs: 'minmax(240px, 40vh) minmax(280px, 1fr)', md: 'minmax(0, 1fr)' } }}>
        <Source doc={doc} />
        <Box sx={{ minHeight: 0, borderRadius: '14px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)' }}>
          <PageText doc={doc} index={current} />
        </Box>
      </Box>
    </Box>
  )
}
