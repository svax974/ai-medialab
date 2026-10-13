/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, Divider, ListItemIcon, Menu, MenuItem } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import RepeatRounded from '@mui/icons-material/RepeatRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useMessageActions, type MessageKind } from '../hooks/useMessageActions'
import { copyText } from '../lib/clipboard'
import { reuseGenerationSettings } from '../lib/draftActions'
import { isActive } from '../lib/messageState'
import type { Message } from '../types'
import { HelpTooltip } from './HelpTooltip'

const VARY_HELP = { titleId: 'thread.footer.vary.title', bodyId: 'thread.footer.vary.body' }

function MoreMenu({ message, kind, onDelete }: { message: Message; kind: MessageKind; onDelete: () => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)
  const run = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <>
      <TipIconButton labelId="thread.footer.more" size="small" onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 28, height: 28 }}>
        <MoreHorizRounded sx={{ fontSize: 18 }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { minWidth: 224 } } }}>
        <MenuItem onClick={run(() => reuseGenerationSettings(message))} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><EditNoteRounded sx={{ fontSize: 16 }} /></ListItemIcon>
          {t('thread.footer.reuseSettings')}
        </MenuItem>
        <MenuItem onClick={run(() => copyText(message.prompt))} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><ContentCopyOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
          {t('thread.footer.copyPrompt')}
        </MenuItem>
        {message.params.seeds && (
          <MenuItem onClick={run(() => copyText((message.params.seeds as number[]).join(', ')))} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><ContentCopyOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
            {t('thread.footer.copySeeds')}
          </MenuItem>
        )}
        <Divider sx={{ my: '4px' }} />
        <MenuItem data-danger onClick={run(onDelete)} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}><DeleteOutlineRounded sx={{ fontSize: 16 }} /></ListItemIcon>
          {t(`thread.footer.delete.${kind}`)}
        </MenuItem>
      </Menu>
    </>
  )
}

/** Under a generation: Cancel while it runs; afterwards new variants, same seeds, and the "more" menu. */
export function MessageFooter({ message, kind = 'image' }: { message: Message; kind?: MessageKind }) {
  const t = useT()
  const { retry, cancel, confirmRemove } = useMessageActions()
  if (isActive(message.status)) {
    return (
      <Box sx={{ mt: '10px', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button size="small" variant="outlined" color="inherit" disabled={cancel.isPending} startIcon={<StopRounded sx={{ fontSize: 12 }} />} onClick={() => cancel.mutate(message.id)} sx={{ height: 28, '&:hover': { borderColor: 'color-mix(in oklab, var(--danger) 50%, transparent)', color: 'var(--danger)' } }}>
          {t('thread.footer.cancel')}
        </Button>
      </Box>
    )
  }
  return (
    <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '2px', opacity: 0.6, transition: 'opacity 0.15s', '.msg:hover &, &:focus-within': { opacity: 1 } }}>
      <HelpTooltip help={VARY_HELP}>
        <Button size="small" variant="text" color="inherit" disabled={retry.isPending} startIcon={<RefreshRounded sx={{ fontSize: 14 }} />} onClick={() => retry.mutate({ id: message.id })} sx={{ height: 28 }}>
          {t('thread.footer.vary')}
        </Button>
      </HelpTooltip>
      <TipIconButton labelId="thread.footer.sameSeeds" hintId="thread.footer.sameSeeds.hint" size="small" disabled={retry.isPending} onClick={() => retry.mutate({ id: message.id, keepSeed: true })} sx={{ width: 28, height: 28 }}>
        <RepeatRounded sx={{ fontSize: 14 }} />
      </TipIconButton>
      <MoreMenu message={message} kind={kind} onDelete={() => void confirmRemove(message, kind)} />
    </Box>
  )
}
