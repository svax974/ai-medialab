/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import RepeatRounded from '@mui/icons-material/RepeatRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useMessageActions } from '@/modules/studio-core/hooks/useMessageActions'
import { isActive } from '@/modules/studio-core/lib/messageState'
import { HelpTooltip } from '@/modules/studio-core'
import type { Message } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { reuseAudioSettings } from '../lib/audioDraftActions'

const REDO_HELP = { titleId: 'audioStudio.footer.redo.title', bodyId: 'audioStudio.footer.redo.body' }

/** Under a synthesis: Cancel while it runs; afterwards "Redo" (new seeds), same seeds, reuse text and settings, delete. */
export function AudioMessageFooter({ message }: { message: Message }) {
  const t = useT()
  const { retry, cancel, confirmRemove } = useMessageActions()
  if (isActive(message.status)) {
    return (
      <Box sx={{ mt: '10px', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button size="small" variant="outlined" color="inherit" disabled={cancel.isPending} startIcon={<StopRounded sx={{ fontSize: 12 }} />} onClick={() => cancel.mutate(message.id)} sx={{ height: 28, '&:hover': { borderColor: 'color-mix(in oklab, var(--danger) 50%, transparent)', color: 'var(--danger)' } }}>{t('thread.footer.cancel')}</Button>
      </Box>
    )
  }
  return (
    <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '2px', opacity: 0.6, transition: 'opacity 0.15s', '.msg:hover &, &:focus-within': { opacity: 1 } }}>
      <HelpTooltip help={REDO_HELP}>
        <Button size="small" variant="text" color="inherit" disabled={retry.isPending} startIcon={<RefreshRounded sx={{ fontSize: 14 }} />} onClick={() => retry.mutate({ id: message.id })} sx={{ height: 28 }}>{t('audioStudio.footer.redo')}</Button>
      </HelpTooltip>
      <TipIconButton labelId="audioStudio.footer.sameSeeds" hintId="audioStudio.footer.sameSeeds.hint" size="small" disabled={retry.isPending} onClick={() => retry.mutate({ id: message.id, keepSeed: true })} sx={{ width: 28, height: 28 }}><RepeatRounded sx={{ fontSize: 14 }} /></TipIconButton>
      <TipIconButton labelId="audioStudio.footer.reuse" size="small" onClick={() => reuseAudioSettings(message)} sx={{ width: 28, height: 28 }}><EditNoteRounded sx={{ fontSize: 14 }} /></TipIconButton>
      <TipIconButton labelId="thread.footer.delete.audio" tone="danger" size="small" onClick={() => void confirmRemove(message, 'audio')} sx={{ width: 28, height: 28 }}><DeleteOutlineRounded sx={{ fontSize: 14 }} /></TipIconButton>
    </Box>
  )
}
