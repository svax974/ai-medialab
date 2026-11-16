/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useRef } from 'react'
import { Box, Button, TextField, Typography } from '@mui/material'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { MEDIA_ACCEPT } from '../lib/transcriptRules'

interface Props {
  kind: 'file' | 'youtube'
  file: File | null
  url: string
  disabled: boolean
  issue: string | null
  onFile: (file: File) => void
  onUrl: (url: string) => void
}

export function TranscriptSource({ kind, file, url, disabled, issue, onFile, onUrl }: Props) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  if (kind === 'youtube') return <TextField required fullWidth type="url" label={t('transcription.youtubeLink')} placeholder="https://www.youtube.com/watch?v=…" value={url} disabled={disabled} onChange={(event) => onUrl(event.target.value)} error={Boolean(issue)} helperText={t(issue || 'transcription.youtubeHelp')} />
  return (
    <Box onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected && !disabled) onFile(selected) }} sx={{ border: '1px dashed var(--line-strong)', borderRadius: '14px', px: 3, py: 4, textAlign: 'center', background: 'var(--bg)' }}>
      <UploadFileOutlined sx={{ fontSize: 32, color: 'var(--safe)', mb: 1 }} />
      <Typography sx={{ fontSize: 15, overflowWrap: 'anywhere' }}>{file?.name || t('transcription.drop')}</Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--faint)', mt: 1, mb: 2 }}>{t('transcription.fileHelp')}</Typography>
      <input ref={input} type="file" accept={MEDIA_ACCEPT} hidden disabled={disabled} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onFile(selected); event.target.value = '' }} />
      <Button variant="outlined" disabled={disabled} onClick={() => input.current?.click()}>{t(file ? 'transcription.changeFile' : 'transcription.browse')}</Button>
      {issue && <Typography role="alert" sx={{ color: 'var(--danger)', fontSize: 13, mt: 2 }}>{t(issue)}</Typography>}
    </Box>
  )
}
