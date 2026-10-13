/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import { startSetup } from '@/modules/engines'
import { useDownloadStore, useModels } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { TRANSCRIBER_ID } from '../lib/voiceForm'

/**
 * "Install it" next to the missing-transcriber notice: installs the Whisper Small model (its engine first, the download
 * follows by itself: `startSetup` of the `engines` module). While it downloads the button says so.
 */
export function TranscriberInstall() {
  const t = useT()
  const { data: catalog } = useModels()
  const running = useDownloadStore((s) => s.downloads[TRANSCRIBER_ID]?.state === 'running')
  const model = catalog?.models.find((candidate) => candidate.id === TRANSCRIBER_ID)
  if (!model) return null
  return (
    <Box component="button" type="button" disabled={running} onClick={() => void startSetup(model)} sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', border: 0, background: 'none', p: 0, fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--safe)', '&:hover': { filter: 'brightness(1.25)' }, '&:disabled': { opacity: 0.6 } }}>
      <CloudDownloadOutlined sx={{ fontSize: 14 }} /> {running ? t('voices.transcript.installing') : t('voices.transcript.install')}
    </Box>
  )
}
