/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Box, Button } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { usePrivateStore } from '@/modules/private/state/privateStore'
import { transcriptApi } from '../services/transcriptApi'
import { isTranscriptActive } from '../lib/transcriptRules'
import type { TranscriptDetail } from '../types'

interface Props { doc: TranscriptDetail; disabled: boolean; dirty: boolean; refresh: () => Promise<void>; text: string }

export function TranscriptActions({ doc, disabled, dirty, refresh, text }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const privateMode = usePrivateStore((state) => state.active)
  const action = useMutation({ mutationFn: async (name: 'cancel' | 'retry' | 'remove') => { await transcriptApi[name](doc.id); return name },
    onSuccess: async (name) => { if (name === 'remove') navigate('/transcriptions'); else await refresh() }, onError: (error) => toast.error(error.message) })
  const ask = async (name: 'remove' | 'retry') => {
    if (await confirm({ titleId: `transcription.${name}`, messageId: `transcription.${name}Confirm` })) action.mutate(name)
  }
  const blocked = disabled || action.isPending
  const active = isTranscriptActive(doc.status)
  return <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button size="small" variant="outlined" disabled={blocked || !text} onClick={() => { void navigator.clipboard.writeText(text).then(() => toast.success(t('transcription.copied')), () => toast.error(t('transcription.error.copy'))) }}>{t('transcription.copy')}</Button>
    <Button size="small" variant="outlined" component="a" href={transcriptApi.exportUrl(doc.id)} download disabled={blocked || dirty || !doc.text}>{t('transcription.export')}</Button>
    {active ? <Button size="small" disabled={action.isPending || (disabled && !privateMode)} onClick={() => action.mutate('cancel')}>{t('transcription.cancel')}</Button> : <Button size="small" disabled={blocked || dirty} onClick={() => void ask('retry')}>{t('transcription.retry')}</Button>}
    <Box sx={{ flex: 1 }} /><Button size="small" color="error" disabled={blocked || active} onClick={() => void ask('remove')}>{t('transcription.remove')}</Button>
  </Box>
}
