/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { ListItemIcon, Menu, MenuItem, Divider } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { copyText } from '@/modules/studio-core/lib/clipboard'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { Asset } from '@/modules/studio-core'
import { useDeleteTake, useSaveTakeAsVoice } from '../hooks/useTakeActions'
import { takeMeta } from '../lib/takes'

/** "More" menu of a take: keep it as a reference voice, copy its text, delete it (with confirmation). */
export function TakeMenu({ asset }: { asset: Asset }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const saveVoice = useSaveTakeAsVoice()
  const deleteTake = useDeleteTake()
  const close = () => setAnchor(null)
  const run = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <>
      <TipIconButton labelId="audioStudio.take.more" size="small" onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 28, height: 28 }}><MoreHorizRounded sx={{ fontSize: 18 }} /></TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { minWidth: 240 } } }}>
        <MenuItem onClick={run(() => saveVoice.mutate(asset))} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><MicRounded sx={{ fontSize: 16 }} /></ListItemIcon>{t('audioStudio.take.keepVoice')}
        </MenuItem>
        <MenuItem onClick={run(() => copyText(takeMeta(asset).prompt))} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><ContentCopyOutlined sx={{ fontSize: 16 }} /></ListItemIcon>{t('audioStudio.take.copyText')}
        </MenuItem>
        <Divider sx={{ my: '4px' }} />
        <MenuItem data-danger onClick={run(() => void deleteTake(asset))} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}><DeleteOutlineRounded sx={{ fontSize: 16 }} /></ListItemIcon>{t('audioStudio.take.delete')}
        </MenuItem>
      </Menu>
    </>
  )
}
