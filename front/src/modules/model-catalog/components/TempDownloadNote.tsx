/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import type { ModelInfo } from '../types'

/** For a model produced locally (quantized from the full-precision original): what is downloaded, what is temporary,
 * and what stays on disk. Nothing while the temporary part is already on disk or the model has none. */
export function TempDownloadNote({ model: m, compact }: { model: ModelInfo; compact?: boolean }) {
  const t = useT()
  const lang = useLang()
  const temp = m.install === 'installed' ? 0 : m.temp_download_gb
  const disk = m.download_size_gb ?? 0
  if (temp <= 0 || disk <= 0) return null
  return (
    <Box component="p" sx={{ m: 0, mt: '4px', fontSize: compact ? 11.5 : 12, lineHeight: 1.4, color: 'var(--warn)' }}>
      {t('models.tempDownload', [formatGb(temp + disk, lang), formatGb(temp, lang), formatGb(disk, lang)])}
    </Box>
  )
}
