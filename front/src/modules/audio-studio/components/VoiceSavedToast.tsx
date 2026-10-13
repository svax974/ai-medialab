/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import { useT } from '@/modules/studio-shell/hooks/useT'

/** Content of the message shown when a take was kept as a voice: what was saved, and a button to edit it. */
export function VoiceSavedToast({ name, onEdit, closeToast }: { name: string; onEdit: () => void; closeToast?: () => void }) {
  const t = useT()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box component="span" sx={{ flex: 1 }}>{t('audioStudio.take.voiceSaved', [name])}</Box>
      <Button size="small" variant="text" onClick={() => { onEdit(); closeToast?.() }}>{t('audioStudio.take.voiceEdit')}</Button>
    </Box>
  )
}
