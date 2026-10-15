/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Menu, MenuItem } from '@mui/material'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import SendRounded from '@mui/icons-material/SendRounded'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { homePathForMode } from '@/modules/studio-shell/lib/routes'
import { usePromptHandoffStore, type HandoffTarget } from '@/modules/studio-core'
import { handoffText, HANDOFF_TARGETS } from '../lib/handoff'
import { selectedTextWithin } from '../lib/selection'
import type { ChatMessage } from '../types'

const ICONS: Record<HandoffTarget, React.ReactNode> = {
  image: <ImageOutlined fontSize="small" />,
  video: <MovieOutlined fontSize="small" />,
  audio: <GraphicEqRounded fontSize="small" />,
}

/**
 * "Send to…" on an answer: the answer, or only the part the user selected in it, becomes the prompt of the image or video
 * studio, or the text to read of the audio one (Markdown marks removed): it fills their composer and opens it.
 */
export function SendToMenu({ message, selectionRoot }: { message: Pick<ChatMessage, 'content'>; selectionRoot: () => Node | null }) {
  const t = useT()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [selection, setSelection] = useState('')
  const send = (target: HandoffTarget) => {
    setAnchor(null)
    const text = handoffText(message.content, selection)
    if (!text) return void toast.info(t('chat.sendTo.empty'))
    usePromptHandoffStore.getState().send(target, text)
    navigate(homePathForMode(target))
  }
  return (
    <>
      {/* The selection is read when the pointer goes down: opening the menu may clear it. */}
      <TipIconButton labelId="chat.sendTo.tip" size="small" aria-haspopup="menu" onPointerDown={() => setSelection(selectedTextWithin(selectionRoot()))} onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 28, height: 28 }}>
        <SendRounded sx={{ fontSize: 14 }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        {selection.trim() && <Box className="cn-eyebrow" sx={{ px: 2, pt: 1 }}>{t('chat.sendTo.selection')}</Box>}
        {HANDOFF_TARGETS.map((target) => (
          <MenuItem key={target} onClick={() => send(target)} sx={{ gap: 1 }}>
            {ICONS[target]} {t(`chat.sendTo.${target}`)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
