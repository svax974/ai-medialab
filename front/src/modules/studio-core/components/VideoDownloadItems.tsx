/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ListItemIcon, MenuItem } from '@mui/material'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import GifBoxOutlined from '@mui/icons-material/GifBoxOutlined'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { downloadAsset } from '../lib/clipboard'
import { downloadVideoCopy } from '../lib/videoCopy'
import type { Asset } from '../types'

/** Menu entries to download a video: the original, then the light copies made to be sent (360p, 240p). */
export function videoDownloadItems(asset: Asset, t: ReturnType<typeof useT>, close: () => void) {
  const run = (action: () => void) => () => {
    close()
    action()
  }
  return [
    <MenuItem key="original" onClick={run(() => downloadAsset(asset))} sx={{ gap: 1.25 }}>
      <ListItemIcon sx={{ minWidth: 0 }}><FileDownloadOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
      {t('thread.export.original')}
    </MenuItem>,
    <MenuItem key="light" onClick={run(() => void downloadVideoCopy(asset, 'light'))} sx={{ gap: 1.25 }}>
      <ListItemIcon sx={{ minWidth: 0 }}><FileDownloadOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
      {t('thread.export.light')}
    </MenuItem>,
    <MenuItem key="tiny" onClick={run(() => void downloadVideoCopy(asset, 'tiny'))} sx={{ gap: 1.25 }}>
      <ListItemIcon sx={{ minWidth: 0 }}><FileDownloadOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
      {t('thread.export.tiny')}
    </MenuItem>,
    <MenuItem key="gif" onClick={run(() => void downloadVideoCopy(asset, 'gif'))} sx={{ gap: 1.25 }}>
      <ListItemIcon sx={{ minWidth: 0 }}><GifBoxOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
      {t('thread.export.gif')}
    </MenuItem>,
    <MenuItem key="gif-tiny" onClick={run(() => void downloadVideoCopy(asset, 'gif-tiny'))} sx={{ gap: 1.25 }}>
      <ListItemIcon sx={{ minWidth: 0 }}><GifBoxOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
      {t('thread.export.gifTiny')}
    </MenuItem>,
  ]
}
