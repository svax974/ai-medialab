/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, Divider, ListItemIcon, Menu, MenuItem } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import RepeatRounded from '@mui/icons-material/RepeatRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useMessageActions } from '@/modules/studio-core/hooks/useMessageActions'
import { copyText, downloadAsset } from '@/modules/studio-core/lib/clipboard'
import { downloadVideoCopy } from '@/modules/studio-core/lib/videoCopy'
import { isActive } from '@/modules/studio-core/lib/messageState'
import { HelpTooltip } from '@/modules/studio-core'
import type { Message } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVideoInputs } from '../hooks/useVideoInputs'
import { reuseVideoSettings } from '../lib/videoDraftActions'
import { VARY_HELP } from '../lib/videoHelp'

/** The "more" menu: for each clip use as the video to edit, last frame as the start, download; then copy the prompt and the seeds, delete. */
function MoreMenu({ message, onDelete }: { message: Message; onDelete: () => void }) {
  const t = useT()
  const { takeAsSource, continueFromLastFrame } = useVideoInputs()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const many = message.outputs.length > 1
  return (
    <>
      <TipIconButton labelId="thread.footer.more" size="small" onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 28, height: 28 }}>
        <MoreHorizRounded sx={{ fontSize: 18 }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { minWidth: 256 } } }}>
        {message.outputs.flatMap((clip, index) => [
          <MenuItem key={`${clip.id}-source`} onClick={run(() => takeAsSource(clip))} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><MovieOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
            {many ? t('videoStudio.footer.menu.asSourceN', [index + 1]) : t('videoStudio.footer.menu.asSource')}
          </MenuItem>,
          <MenuItem key={`${clip.id}-frame`} onClick={run(() => void continueFromLastFrame(clip))} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><SubdirectoryArrowRightRounded sx={{ fontSize: 16 }} /></ListItemIcon>
            {many ? t('videoStudio.footer.menu.lastFrameN', [index + 1]) : t('videoStudio.footer.menu.lastFrame')}
          </MenuItem>,
          <MenuItem key={`${clip.id}-download`} onClick={run(() => downloadAsset(clip))} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><FileDownloadOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
            {many ? t('videoStudio.footer.menu.downloadN', [index + 1]) : t('videoStudio.footer.menu.download')}
          </MenuItem>,
          <MenuItem key={`${clip.id}-light`} onClick={run(() => void downloadVideoCopy(clip, 'light'))} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><FileDownloadOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
            {many ? t('videoStudio.footer.menu.downloadLightN', [index + 1]) : t('thread.export.light')}
          </MenuItem>,
        ])}
        {message.outputs.length > 0 && <Divider sx={{ my: '4px' }} />}
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
          {t('thread.footer.delete.video')}
        </MenuItem>
      </Menu>
    </>
  )
}

/** Under a generation: Cancel while it runs; afterwards "Vary" (new seeds), same seeds, reuse the settings in the composer, and the "more" menu. */
export function VideoMessageFooter({ message, siblings }: { message: Message; siblings: readonly Message[] }) {
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
      <HelpTooltip help={VARY_HELP}>
        <Button size="small" variant="text" color="inherit" disabled={retry.isPending} startIcon={<RefreshRounded sx={{ fontSize: 14 }} />} onClick={() => retry.mutate({ id: message.id })} sx={{ height: 28 }}>{t('videoStudio.footer.vary')}</Button>
      </HelpTooltip>
      <TipIconButton labelId="thread.footer.sameSeeds" hintId="videoStudio.footer.sameSeeds.hint" size="small" disabled={retry.isPending} onClick={() => retry.mutate({ id: message.id, keepSeed: true })} sx={{ width: 28, height: 28 }}><RepeatRounded sx={{ fontSize: 14 }} /></TipIconButton>
      <TipIconButton labelId="videoStudio.footer.reuse" size="small" onClick={() => reuseVideoSettings(message, siblings)} sx={{ width: 28, height: 28 }}><EditNoteRounded sx={{ fontSize: 14 }} /></TipIconButton>
      <MoreMenu message={message} onDelete={() => void confirmRemove(message, 'video')} />
    </Box>
  )
}
