/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'react'
import { Box, Menu, MenuItem } from '@mui/material'
import CompareArrowsRounded from '@mui/icons-material/CompareArrowsRounded'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useModels } from '@/modules/model-catalog'
import { copyText } from '@/modules/studio-core/lib/clipboard'
import { formatTime } from '@/modules/studio-core/lib/format'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import type { ChatMessage } from '../types'
import { AssistantBody } from './AssistantBody'
import { CompareView } from './CompareView'
import { useModelName } from '../hooks/useModelName'
import { BranchNav } from './MessageParts'
import { SendToMenu } from './SendToMenu'

interface Props {
  message: ChatMessage
  /** Other answers to the same question that come from other models (this browser has seen them): the comparison. */
  group: ChatMessage[] | null
  /** Another answer is being written (this one, or elsewhere): the actions that start one wait. */
  busy: boolean
  onRegenerate: (message: ChatMessage, modelId?: string) => void
  onDelete: (message: ChatMessage) => void
  onSwitch: (id: string) => void
  onStop: () => void
}

function RegenerateMenu({ message, disabled, onRegenerate }: { message: ChatMessage; disabled: boolean; onRegenerate: Props['onRegenerate'] }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { data } = useModels()
  const own = useModelName(message.model_id)
  const others = (data?.models ?? []).filter((m) => m.kind === 'llm' && m.ready && m.id !== message.model_id)
  const pick = (modelId?: string) => {
    setAnchor(null)
    onRegenerate(message, modelId)
  }
  return (
    <>
      <TipIconButton labelId="chat.action.regenerate" size="small" disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="menu" sx={{ width: 28, height: 28 }}>
        <RefreshRounded sx={{ fontSize: 15 }} />
      </TipIconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        <MenuItem onClick={() => pick()}>{own ? t('chat.regenerate.same', [own]) : t('chat.regenerate.sameModel')}</MenuItem>
        {others.length > 0 && <Box className="cn-eyebrow" sx={{ px: 2, pt: 1 }}>{t('chat.regenerate.other')}</Box>}
        {others.map((m) => (
          <MenuItem key={m.id} onClick={() => pick(m.id)}>{m.name}</MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** An answer of the model: its body, then hover actions (copy, regenerate with the same or another model, compare, delete, stop). */
export function AssistantMessageView({ message, group, busy, onRegenerate, onDelete, onSwitch, onStop }: Props) {
  const lang = useLang()
  const [compare, setCompare] = useState(false)
  const root = useRef<HTMLElement>(null)
  const streaming = message.status === 'streaming'
  if (compare && group) return <CompareView group={group} activeId={message.id} onChoose={(id) => { setCompare(false); if (id !== message.id) onSwitch(id) }} onClose={() => setCompare(false)} />
  return (
    <Box ref={root} className="assistant" component="article" aria-busy={streaming} sx={{ display: 'flex', flexDirection: 'column', gap: 1, animation: 'var(--animate-rise)' }}>
      <AssistantBody message={message} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: streaming || message.sibling_ids.length > 1 ? 1 : 0, transition: 'opacity 0.15s', '.assistant:hover &, &:focus-within': { opacity: 1 } }}>
        <Box component="span" sx={{ mr: '4px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{formatTime(message.created_at, lang)}</Box>
        <BranchNav message={message} onSwitch={onSwitch} disabled={busy} />
        {streaming ? (
          <TipIconButton labelId="chat.action.stop" tone="danger" size="small" onClick={onStop} sx={{ width: 28, height: 28 }}>
            <StopRounded sx={{ fontSize: 16 }} />
          </TipIconButton>
        ) : (
          <>
            <TipIconButton labelId="chat.action.copy" size="small" onClick={() => copyText(message.content)} sx={{ width: 28, height: 28 }}>
              <ContentCopyOutlined sx={{ fontSize: 14 }} />
            </TipIconButton>
            {message.content.trim() !== '' && <SendToMenu message={message} selectionRoot={() => root.current} />}
            <RegenerateMenu message={message} disabled={busy} onRegenerate={onRegenerate} />
            {group && (
              <TipIconButton labelId="chat.action.compare" size="small" onClick={() => setCompare(true)} sx={{ width: 28, height: 28 }}>
                <CompareArrowsRounded sx={{ fontSize: 16 }} />
              </TipIconButton>
            )}
            <TipIconButton labelId="chat.action.delete" tone="danger" size="small" disabled={busy} onClick={() => onDelete(message)} sx={{ width: 28, height: 28 }}>
              <DeleteOutlineRounded sx={{ fontSize: 14 }} />
            </TipIconButton>
          </>
        )}
      </Box>
    </Box>
  )
}
