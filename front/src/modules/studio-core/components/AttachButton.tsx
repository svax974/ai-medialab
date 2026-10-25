/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState, type ComponentProps } from 'react'
import { Box, IconButton, ListItemIcon, Menu, MenuItem, Tooltip, type SxProps, type Theme } from '@mui/material'
import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import ComputerOutlined from '@mui/icons-material/ComputerOutlined'
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined'
import { HelpBody, helpTooltipSlotProps } from '@/modules_shared/common/components/ui/help'
import { tipIconButtonSx } from '@/modules_shared/common/components/ui/iconbutton'
import { AssetPickerDialog } from '@/modules/media-library/components/AssetPickerDialog'
import type { Asset } from '@/modules/media-library/types'
import { useT } from '@/modules/studio-shell/hooks/useT'

interface AttachButtonProps {
  labelId: string
  /** Longer tooltip than the label (what the slots above the prompt accept). */
  help?: ComponentProps<typeof HelpBody>
  /** Opens the system file picker of the composer. */
  onBrowse: () => void
  /** Receives the generated images picked in the library. */
  onPickAssets: (assets: Asset[]) => void
  /** Several images can be picked at once (default). */
  multiple?: boolean
  sx?: SxProps<Theme>
}

/** The paperclip of a composer: a menu to add a file from the computer, or images already generated here. */
export function AttachButton({ labelId, help, onBrowse, onPickAssets, multiple = true, sx }: AttachButtonProps) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [picking, setPicking] = useState(false)
  const [tip, setTip] = useState(false)
  const size = sx ?? { width: 32, height: 32 }
  const close = () => setAnchor(null)
  return (
    <>
      {/* The tooltip stays closed while the menu is open: it would cover the menu items. */}
      <Tooltip title={help ? <HelpBody {...help} /> : t(labelId)} placement="top" enterDelay={350} open={tip && !anchor} onOpen={() => setTip(true)} onClose={() => setTip(false)} slotProps={helpTooltipSlotProps}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <IconButton aria-label={t(labelId)} onClick={(event) => { setTip(false); setAnchor(event.currentTarget) }} sx={[tipIconButtonSx('default', false), ...(Array.isArray(size) ? size : [size])]}>
            <AttachFileRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <MenuItem onClick={() => { close(); onBrowse() }} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><ComputerOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
          {t('thread.attach.computer')}
        </MenuItem>
        <MenuItem onClick={() => { close(); setPicking(true) }} sx={{ gap: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><PhotoLibraryOutlined sx={{ fontSize: 16 }} /></ListItemIcon>
          {t('thread.attach.generated')}
        </MenuItem>
      </Menu>
      <AssetPickerDialog open={picking} onClose={() => setPicking(false)} onPick={onPickAssets} multiple={multiple} />
    </>
  )
}
