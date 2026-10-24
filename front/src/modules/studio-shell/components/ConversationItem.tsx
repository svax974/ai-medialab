/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, Checkbox, IconButton, InputBase, Menu, MenuItem, Divider } from '@mui/material'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import PushPin from '@mui/icons-material/PushPin'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import { Link, useNavigate } from 'react-router-dom'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { formatClock } from '../lib/periods'
import { homePathForMode, studioPaths } from '../lib/routes'
import { resolveMediaUrl } from '../services/studioHttp'
import { useConversationActions } from '../hooks/useConversations'
import { useLang, useT } from '../hooks/useT'
import type { ConversationSummary, ConversationMode } from '../types'
import { ModeIcon } from './modeIcons'

const META_KEYS: Record<ConversationMode, string> = {
  image: 'studio.conversation.meta.image',
  audio: 'studio.conversation.meta.audio',
  video: 'studio.conversation.meta.video',
  chat: 'studio.conversation.meta.chat',
  diagram: 'studio.conversation.meta.diagram',
}
const DELETE_MEDIA_KEYS: Record<ConversationMode, string> = {
  image: 'studio.conversation.delete.media.image',
  audio: 'studio.conversation.delete.media.audio',
  video: 'studio.conversation.delete.media.video',
  chat: 'studio.conversation.delete.media.chat',
  diagram: 'studio.conversation.delete.media.diagram',
}
const DELETE_MESSAGE_KEYS: Record<ConversationMode, string> = {
  image: 'studio.conversation.delete.message',
  audio: 'studio.conversation.delete.message',
  video: 'studio.conversation.delete.message',
  chat: 'studio.conversation.delete.message.chat',
  diagram: 'studio.conversation.delete.message',
}

/** Thumbnail: the cover, else the mode's icon on the tray gradient; a breathing dot while a job is running. */
function Thumbnail({ conversation }: { conversation: ConversationSummary }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 36,
        height: 36,
        flexShrink: 0,
        overflow: 'hidden',
        borderRadius: '8px',
        backgroundColor: 'var(--surface-3)',
        boxShadow: 'inset 0 0 0 1px var(--line)',
      }}
    >
      {conversation.cover ? (
        <Box component="img" src={resolveMediaUrl(conversation.cover.thumb_url)} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Box className="cn-tray" sx={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'color-mix(in oklab, var(--safe) 80%, transparent)' }}>
          {conversation.mode !== 'image' && <ModeIcon mode={conversation.mode} />}
        </Box>
      )}
      {conversation.busy && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', backgroundColor: 'rgb(0 0 0 / 0.4)' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--safe)', boxShadow: '0 0 10px var(--safe)', animation: 'var(--animate-breathe)' }} />
        </Box>
      )}
    </Box>
  )
}

interface ConversationItemProps {
  conversation: ConversationSummary
  active: boolean
  /** Selection mode: a click ticks the row instead of opening it. */
  selecting?: boolean
  selected?: boolean
  onToggle?: (id: string) => void
}

/** One conversation of the list: open, rename (double click or menu), pin, delete; ticked in selection mode. */
export function ConversationItem({ conversation, active, selecting = false, selected = false, onToggle }: ConversationItemProps) {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const { update, remove } = useConversationActions()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const saveTitle = () => {
    setRenaming(false)
    const next = title.trim()
    if (!next || next === conversation.title) return setTitle(conversation.title)
    update.mutate({ id: conversation.id, patch: { title: next } })
  }
  const cancelRename = () => {
    setTitle(conversation.title)
    setRenaming(false)
  }

  const askDelete = async () => {
    setMenuAnchor(null)
    const ok = await confirm({
      titleId: 'studio.conversation.delete.title',
      messageId: DELETE_MESSAGE_KEYS[conversation.mode],
      params: [conversation.title, conversation.generation_count, t(DELETE_MEDIA_KEYS[conversation.mode])],
      confirmLabelId: 'studio.conversation.delete.confirm',
      danger: true,
    })
    if (!ok) return
    remove.mutate(conversation.id, {
      onSuccess: () => {
        if (active) navigate(homePathForMode(conversation.mode), { replace: true })
      },
    })
  }

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        px: 1,
        py: '6px',
        borderRadius: '12px',
        backgroundColor: selected ? 'var(--surface-3)' : active ? 'var(--surface-3)' : 'transparent',
        transition: 'background-color 0.15s',
        '&:hover': { backgroundColor: active ? 'var(--surface-3)' : 'var(--surface-2)' },
        '&:hover .row-actions, & .row-actions:focus-within': { opacity: 1 },
      }}
    >
      {selecting ? (
        <ButtonBase
          role="checkbox"
          aria-checked={selected}
          aria-label={t('studio.select.row', [conversation.title])}
          onClick={() => onToggle?.(conversation.id)}
          sx={{ position: 'absolute', inset: 0, borderRadius: '12px' }}
        />
      ) : (
        <ButtonBase
          component={Link}
          to={studioPaths.conversation(conversation.id)}
          aria-label={conversation.title}
          aria-current={active ? 'page' : undefined}
          onDoubleClick={() => setRenaming(true)}
          sx={{ position: 'absolute', inset: 0, borderRadius: '12px' }}
        />
      )}
      {selecting && <Checkbox checked={selected} tabIndex={-1} size="small" disableRipple sx={{ position: 'relative', p: 0, pointerEvents: 'none' }} />}
      <Thumbnail conversation={conversation} />
      <Box sx={{ position: 'relative', minWidth: 0, flex: 1, pointerEvents: 'none' }}>
        {renaming ? (
          <InputBase
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveTitle()
              if (event.key === 'Escape') cancelRename()
            }}
            sx={{
              pointerEvents: 'auto',
              width: '100%',
              px: '6px',
              py: '2px',
              fontSize: 14,
              borderRadius: '6px',
              backgroundColor: 'var(--surface)',
              boxShadow: 'inset 0 0 0 1px var(--line-strong)',
            }}
          />
        ) : (
          <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, color: active ? 'var(--ink)' : 'var(--ink-2)' }}>
            {conversation.title}
          </Box>
        )}
        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>
          {t(META_KEYS[conversation.mode], [conversation.generation_count, formatClock(conversation.updated_at, lang)])}
        </Box>
      </Box>
      {!selecting && (
        <Box className="row-actions" sx={{ position: 'relative', opacity: menuAnchor ? 1 : 0, transition: 'opacity 0.15s' }}>
          <IconButton size="small" aria-label={t('studio.conversation.actions')} onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ width: 24, height: 24 }}>
            <MoreHorizRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      )}
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }} slotProps={{ list: { dense: true } }}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            update.mutate({ id: conversation.id, patch: { pinned: !conversation.pinned } })
          }}
        >
          {conversation.pinned ? <PushPin /> : <PushPinOutlined />}
          {conversation.pinned ? t('studio.conversation.unpin') : t('studio.conversation.pin')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setRenaming(true)
          }}
        >
          <EditOutlined /> {t('studio.conversation.rename')}
        </MenuItem>
        <Divider sx={{ my: '4px !important' }} />
        <MenuItem data-danger onClick={askDelete}>
          <DeleteOutlineRounded /> {t('studio.conversation.delete')}
        </MenuItem>
      </Menu>
    </Box>
  )
}
