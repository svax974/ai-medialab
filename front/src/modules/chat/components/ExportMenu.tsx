/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Menu, MenuItem } from '@mui/material'
import { toast } from 'react-toastify'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { chatApi, type ExportFormat } from '../services/chatApi'

/** The export of the conversation: Markdown (readable) or JSON (complete, with the branches' settings). The browser downloads the file. */
export function ExportMenu({ conversationId }: { conversationId: string }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const download = (format: ExportFormat) => {
    setAnchor(null)
    chatApi.exportFile(conversationId, format).then(({ href, name }) => {
      const link = document.createElement('a')
      link.href = href
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
    }, (error: Error) => void toast.error(error.message))
  }
  return (
    <>
      <TipIconButton labelId="chat.export.tip" onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="menu" sx={{ width: 32, height: 32 }}>
        <FileDownloadOutlined sx={{ fontSize: 16 }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        <MenuItem onClick={() => download('md')}>{t('chat.export.md')}</MenuItem>
        <MenuItem onClick={() => download('json')}>{t('chat.export.json')}</MenuItem>
      </Menu>
    </>
  )
}
