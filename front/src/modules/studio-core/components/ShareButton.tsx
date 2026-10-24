/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState, type ReactElement } from 'react'
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem, type SxProps, type Theme } from '@mui/material'
import IosShareRounded from '@mui/icons-material/IosShareRounded'
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded'
import SmsOutlined from '@mui/icons-material/SmsOutlined'
import WhatsApp from '@mui/icons-material/WhatsApp'
import X from '@mui/icons-material/X'
import { toast } from 'react-toastify'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { downloadName } from '../lib/messageState'
import { hasSystemShare, loadShareFile, openShareTarget, shareTargets, shareWithSystem, type ShareTargetId } from '../lib/share'
import { makeVideoCopy } from '../lib/videoCopy'
import { assetPrompt } from '../lib/viewerDetails'
import type { Asset } from '../types'

const ICONS: Record<ShareTargetId, ReactElement> = {
  mail: <MailOutlineRounded sx={{ fontSize: 16 }} />,
  whatsapp: <WhatsApp sx={{ fontSize: 16 }} />,
  messages: <SmsOutlined sx={{ fontSize: 16 }} />,
  x: <X sx={{ fontSize: 16 }} />,
}

interface ShareButtonProps {
  asset: Asset
  /** File name given to the shared media (default: the download name of the asset). */
  fileName?: string
  tone?: 'default'
  size?: 'small' | 'medium'
  iconSize?: number
  sx?: SxProps<Theme>
}

/**
 * Share a produced image, sound, video or diagram. The system share sheet attaches the file itself (Mail, Messages,
 * WhatsApp, X, Facebook, Instagram... whatever is installed); the per-service entries open the service with the prompt
 * as text only, since a web link cannot carry the file of a local application.
 */
export function ShareButton({ asset, fileName, tone, size = 'small', iconSize = 16, sx }: ShareButtonProps) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const name = fileName ?? downloadName(asset)
  const text = assetPrompt(asset) ?? ''
  const file = useRef<Promise<File> | null>(null)
  const system = hasSystemShare()

  const open = (event: React.MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget)
    // Read the media while the menu is open: the share sheet must be called right after the click.
    if (system && !file.current) file.current = loadShareFile(resolveMediaUrl(asset.url), name)
    file.current?.catch(() => (file.current = null))
  }
  const close = () => setAnchor(null)

  const shareFile = async () => {
    close()
    try {
      await shareWithSystem(await (file.current ?? loadShareFile(resolveMediaUrl(asset.url), name)), text)
    } catch {
      toast.error(t('thread.share.failed'))
    }
  }

  // The copy is made after the click: the system sheet may refuse it without a fresh user gesture (not verified), in
  // which case the user downloads the light version from the video menu and attaches it.
  const shareLight = async () => {
    close()
    try {
      const copy = await makeVideoCopy(asset, 'light')
      await shareWithSystem(await loadShareFile(copy.url, copy.name), text)
    } catch {
      toast.error(t('thread.share.failed'))
    }
  }

  return (
    <>
      <TipIconButton labelId="thread.share" tone={tone} size={size} onClick={open} sx={sx}>
        <IosShareRounded sx={{ fontSize: iconSize }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} slotProps={{ paper: { sx: { minWidth: 208 } } }}>
        {system && (
          <MenuItem onClick={() => void shareFile()} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><IosShareRounded sx={{ fontSize: 16 }} /></ListItemIcon>
            <ListItemText primary={t('thread.share.system')} secondary={t('thread.share.system.hint')} />
          </MenuItem>
        )}
        {system && asset.media === 'video' && (
          <MenuItem onClick={() => void shareLight()} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><IosShareRounded sx={{ fontSize: 16 }} /></ListItemIcon>
            <ListItemText primary={t('thread.share.system.light')} />
          </MenuItem>
        )}
        {system && <Divider sx={{ my: '4px' }} />}
        {shareTargets().map((target) => (
          <MenuItem key={target.id} onClick={() => { close(); openShareTarget(target, text, t('thread.share.subject')) }} sx={{ gap: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}>{ICONS[target.id]}</ListItemIcon>
            {t(`thread.share.${target.id}`)}
          </MenuItem>
        ))}
        <ListItemText sx={{ px: 2, py: 0.5, maxWidth: 240, whiteSpace: 'normal' }} secondary={t('thread.share.textOnly')} />
      </Menu>
    </>
  )
}
