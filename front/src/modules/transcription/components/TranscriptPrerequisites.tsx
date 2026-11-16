/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Alert, Button } from '@mui/material'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useInstallPack, useInstallStore } from '@/modules/engines'
import { useComponents, componentsKey } from '@/modules/engines/hooks/useComponents'
import { useT } from '@/modules/studio-shell/hooks/useT'

export function TranscriptPrerequisites() {
  const t = useT()
  const { data } = useComponents()
  const install = useInstallPack()
  const query = useQueryClient()
  const state = useInstallStore((value) => value.packInstall)
  useEffect(() => {
    if (state.state === 'done') void query.invalidateQueries({ queryKey: componentsKey })
  }, [state.state, query])
  const missing = data?.find((component) => component.id === 'ffmpeg' && !component.installed)
  if (!missing) return null
  const busy = state.state === 'running' || install.isPending
  return <Alert severity="info" sx={{ mt: 2 }} action={<Button disabled={busy} onClick={() => install.mutate('ffmpeg')}>{t(busy ? 'transcription.installing' : 'transcription.installReader')}</Button>}>{t('transcription.readerNeeded')}</Alert>
}
