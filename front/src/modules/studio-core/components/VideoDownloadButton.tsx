/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Menu, type SxProps, type Theme } from '@mui/material'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { Asset } from '../types'
import { videoDownloadItems } from './VideoDownloadItems'

/** Download button of a video: a menu with the original and the light copies (360p, 240p) to send. */
export function VideoDownloadButton({ asset, labelId, tone, size = 'small', iconSize = 16, sx }: {
  asset: Asset
  labelId: string
  tone?: 'default'
  size?: 'small' | 'medium'
  iconSize?: number
  sx?: SxProps<Theme>
}) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)
  return (
    <>
      <TipIconButton labelId={labelId} tone={tone} size={size} onClick={(event) => setAnchor(event.currentTarget)} sx={sx}>
        <FileDownloadOutlined sx={{ fontSize: iconSize }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} slotProps={{ paper: { sx: { minWidth: 224 } } }}>
        {videoDownloadItems(asset, t, close)}
      </Menu>
    </>
  )
}
