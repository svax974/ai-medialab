/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Alert, Box, Button, LinearProgress, MenuItem, Paper, Tab, Tabs, TextField } from '@mui/material'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { SetupPrompt } from '@/modules/engines'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { fileIssue } from '../lib/transcriptRules'
import { useTranscriptComposer } from '../hooks/useTranscriptComposer'
import { TranscriptSource } from './TranscriptSource'
import { TranscriptPrerequisites } from './TranscriptPrerequisites'

export function TranscriptComposer() {
  const t = useT()
  const { models, model, setChosen, kind, setKind, file, setFile, url, setUrl, language, setLanguage, issue, setIssue, uploaded, create, privateMode, readerReady, submit } = useTranscriptComposer()
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: '20px' }}>
    <Tabs value={kind} onChange={(_event, value: 'file' | 'youtube') => { setKind(value); setIssue(null) }} sx={{ mb: 3 }} aria-label={t('transcription.source')}><Tab value="file" label={t('transcription.file')} disabled={create.isPending} /><Tab value="youtube" label={t('transcription.youtube')} disabled={create.isPending} /></Tabs>
    <TranscriptSource kind={kind} file={file} url={url} disabled={create.isPending} issue={issue} onFile={(selected) => { setFile(selected); setIssue(fileIssue(selected)) }} onUrl={setUrl} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: 2, mt: 3 }}>
      <TextField select required label={t('transcription.model')} value={model?.id ?? ''} disabled={create.isPending || !models.length} onChange={(event) => setChosen(event.target.value)}>{models.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}{item.ready ? '' : ` · ${t('transcription.toInstall')}`}</MenuItem>)}</TextField>
      <TextField select label={t('transcription.language')} value={language} disabled={create.isPending} onChange={(event) => setLanguage(event.target.value)}>{['auto', 'fr', 'en', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ar'].map((id) => <MenuItem key={id} value={id}>{t(`transcription.language.${id}`)}</MenuItem>)}</TextField>
    </Box>
    {model && !model.ready && <Box sx={{ mt: 2 }}><SetupPrompt model={model} /></Box>}
    {!models.length && <Alert severity="info" sx={{ mt: 2 }} action={<Button onClick={() => useStudioStore.getState().openModelSearch('audio')}>{t('transcription.models')}</Button>}>{t('transcription.noModels')}</Alert>}
    <TranscriptPrerequisites />
    {privateMode && <Alert severity="info" sx={{ mt: 2 }}>{t('transcription.private')}</Alert>}
    {create.error && <Alert severity="error" sx={{ mt: 2 }}>{create.error.message}</Alert>}
    {create.isPending && <LinearProgress sx={{ mt: 2 }} variant={uploaded === null ? 'indeterminate' : 'determinate'} value={uploaded ?? 0} />}
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}><Button variant="contained" size="large" startIcon={<PlayArrowRounded />} onClick={submit} disabled={create.isPending || !readerReady || !model?.ready || model.engine_available === false || privateMode}>{t(create.isPending ? 'transcription.uploading' : 'transcription.start')}</Button></Box>
  </Paper>
}
