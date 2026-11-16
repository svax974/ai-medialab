/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, LinearProgress, Link, Paper, Typography } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { usePrivateStore } from '@/modules/private/state/privateStore'
import { useTranscript } from '../hooks/useTranscripts'
import { isTranscriptActive, mediaDuration } from '../lib/transcriptRules'
import { transcriptApi } from '../services/transcriptApi'
import type { TranscriptDetail } from '../types'
import { TranscriptActions } from './TranscriptActions'

interface Props { id: string }
interface EditorProps { doc: TranscriptDetail; refresh: () => Promise<void> }

export function TranscriptResult({ id }: Props) {
  const t = useT()
  const result = useTranscript(id)
  if (result.loading && !result.data) return <Box sx={{ p: 4 }}><CircularProgress size={24} /></Box>
  if (result.error || !result.data) return <Alert severity="error">{result.error instanceof Error ? result.error.message : t('transcription.error.load')}</Alert>
  return <TranscriptEditor doc={result.data} refresh={result.refetch} />
}

function TranscriptEditor({ doc, refresh }: EditorProps) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const privateMode = usePrivateStore((state) => state.active)
  const text = draft ?? doc.text
  const dirty = draft !== null && draft !== doc.text
  const active = isTranscriptActive(doc.status)
  const save = useMutation({ mutationFn: () => transcriptApi.edit(doc.id, text), onSuccess: async () => { await refresh(); setDraft(null) } })
  const blocked = save.isPending || privateMode
  return <Box sx={{ width: '100%', maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 4 }, overflowY: 'auto' }}>
    <Typography sx={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--safe)', mb: 1 }}>{t('transcription.heading')}</Typography>
    <Typography component="h1" sx={{ fontFamily: 'var(--font-display)', fontSize: { xs: 28, md: 40 }, lineHeight: 1.2, overflowWrap: 'anywhere', mb: 1 }}>{doc.title}</Typography>
    <Typography sx={{ fontSize: 13, color: 'var(--faint)', mb: 2 }}>{doc.model_name} · {t(`transcription.stage.${doc.stage}`)}{doc.duration > 0 ? ` · ${mediaDuration(doc.processed_seconds)} / ${mediaDuration(doc.duration)}` : ''}</Typography>
    {doc.source_url && <Link href={doc.source_url} target="_blank" rel="noreferrer" sx={{ display: 'inline-block', fontSize: 12, mb: 2 }}>{t('transcription.openSource')}</Link>}
    {active && <Box role="status" aria-live="polite" sx={{ mb: 3 }}><LinearProgress variant={doc.progress === null ? 'indeterminate' : 'determinate'} value={doc.progress ?? 0} /><Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 1 }}>{t('transcription.background')}</Typography></Box>}
    {doc.error && <Alert severity="error" sx={{ mb: 2 }}>{doc.error}</Alert>}
    {doc.status === 'cancelled' && <Alert severity="info" sx={{ mb: 2 }}>{t('transcription.partial')}</Alert>}
    {privateMode && <Alert severity="info" sx={{ mb: 2 }}>{t('transcription.private')}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: '16px' }}>
      <TranscriptActions doc={doc} text={text} dirty={dirty} disabled={blocked} refresh={refresh} />
      <Typography component="label" htmlFor={`transcript-${doc.id}`} sx={{ display: 'block', fontSize: 11, color: 'var(--faint)', mt: 3, mb: 1 }}>{t('transcription.text')}</Typography>
      <Box component="textarea" id={`transcript-${doc.id}`} maxLength={1_000_000} value={text} onChange={(event) => setDraft(event.target.value)} readOnly={active || privateMode} disabled={save.isPending} placeholder={t(active ? 'transcription.waitText' : 'transcription.noSpeech')} sx={{ boxSizing: 'border-box', width: '100%', minHeight: '42vh', resize: 'vertical', border: 0, outlineColor: 'var(--safe)', background: 'transparent', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 16, lineHeight: 1.9 }} />
      {!active && <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'flex-end', mt: 2 }}><Typography sx={{ fontSize: 12, color: 'var(--faint)' }}>{t(dirty ? 'transcription.unsaved' : 'transcription.saved')}</Typography><Button variant="contained" disabled={!dirty || blocked} onClick={() => save.mutate()}>{t(save.isPending ? 'transcription.saving' : 'transcription.save')}</Button></Box>}
      {save.error && <Alert severity="error" sx={{ mt: 2 }}>{save.error.message}</Alert>}
    </Paper>
  </Box>
}
