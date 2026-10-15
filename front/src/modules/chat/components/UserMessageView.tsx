/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { copyText } from '@/modules/studio-core/lib/clipboard'
import { formatTime } from '@/modules/studio-core/lib/format'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import type { ChatMessage } from '../types'
import { AttachmentList, BranchNav } from './MessageParts'

interface Props {
  message: ChatMessage
  busy: boolean
  onEdit: (message: ChatMessage, content: string) => void
  onDelete: (message: ChatMessage) => void
  onSwitch: (id: string) => void
}

/** What the user wrote: attachments, the text, and hover actions (copy, edit as a new branch, delete) with the branch navigator. */
export function UserMessageView({ message, busy, onEdit, onDelete, onSwitch }: Props) {
  const t = useT()
  const lang = useLang()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const send = () => {
    const text = draft.trim()
    if (!text || busy) return
    setEditing(false)
    if (text !== message.content) onEdit(message, text)
  }
  return (
    <Box className="user" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, animation: 'var(--animate-rise)' }}>
      <AttachmentList attachments={message.attachments} />
      {editing ? (
        <Box sx={{ width: 'min(620px, 100%)', display: 'grid', gap: 1 }}>
          <Box
            component="textarea"
            autoFocus
            rows={Math.min(10, Math.max(2, draft.split('\n').length))}
            value={draft}
            aria-label={t('chat.edit.aria')}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === 'Escape') setEditing(false)
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) send()
            }}
            sx={{ width: '100%', resize: 'vertical', borderRadius: '12px', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface)', p: 1.5, fontFamily: 'inherit', fontSize: 15, lineHeight: 1.6, color: 'var(--ink)', outline: 'none' }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Box component="span" sx={{ alignSelf: 'center', mr: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{t('chat.edit.hint')}</Box>
            <Button size="small" color="inherit" onClick={() => setEditing(false)}>{t('chat.edit.cancel')}</Button>
            <Button size="small" variant="contained" disabled={!draft.trim() || busy} onClick={send}>{t('chat.edit.send')}</Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ maxWidth: 'min(620px, 90%)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderRadius: '16px 16px 6px 16px', backgroundColor: 'var(--surface-3)', px: 2, py: 1.25, fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>{message.content}</Box>
      )}
      {!editing && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: message.sibling_ids.length > 1 ? 1 : 0, transition: 'opacity 0.15s', '.user:hover &, &:focus-within': { opacity: 1 } }}>
          <Box component="span" sx={{ mr: '4px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{formatTime(message.created_at, lang)}</Box>
          <BranchNav message={message} onSwitch={onSwitch} disabled={busy} />
          <TipIconButton labelId="chat.action.copy" size="small" onClick={() => copyText(message.content)} sx={{ width: 28, height: 28 }}>
            <ContentCopyOutlined sx={{ fontSize: 14 }} />
          </TipIconButton>
          <TipIconButton labelId="chat.action.edit" size="small" disabled={busy} onClick={() => { setDraft(message.content); setEditing(true) }} sx={{ width: 28, height: 28 }}>
            <EditOutlined sx={{ fontSize: 14 }} />
          </TipIconButton>
          <TipIconButton labelId="chat.action.delete" tone="danger" size="small" disabled={busy} onClick={() => onDelete(message)} sx={{ width: 28, height: 28 }}>
            <DeleteOutlineRounded sx={{ fontSize: 14 }} />
          </TipIconButton>
        </Box>
      )}
    </Box>
  )
}
