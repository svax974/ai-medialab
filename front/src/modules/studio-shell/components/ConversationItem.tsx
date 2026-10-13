/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, IconButton, InputBase, Menu, MenuItem, Divider } from '@mui/material'
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
import type { ConversationSummary, StudioMode } from '../types'
import { ModeIcon } from './modeIcons'

const META_KEYS: Record<StudioMode, string> = {
  image: 'studio.conversation.meta.image',
  audio: 'studio.conversation.meta.audio',
  video: 'studio.conversation.meta.video',
}
const DELETE_MEDIA_KEYS: Record<StudioMode, string> = {
  image: 'studio.conversation.delete.media.image',
  audio: 'studio.conversation.delete.media.audio',
  video: 'studio.conversation.delete.media.video',
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

/** One conversation of the list: open, rename (double click or menu), pin, delete. */
export function ConversationItem({ conversation, active }: { conversation: ConversationSummary; active: boolean }) {
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
      messageId: 'studio.conversation.delete.message',
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
        backgroundColor: active ? 'var(--surface-3)' : 'transparent',
        transition: 'background-color 0.15s',
        '&:hover': { backgroundColor: active ? 'var(--surface-3)' : 'var(--surface-2)' },
        '&:hover .row-actions, & .row-actions:focus-within': { opacity: 1 },
      }}
    >
      <ButtonBase
        component={Link}
        to={studioPaths.conversation(conversation.id)}
        aria-label={conversation.title}
        aria-current={active ? 'page' : undefined}
        onDoubleClick={() => setRenaming(true)}
        sx={{ position: 'absolute', inset: 0, borderRadius: '12px' }}
      />
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
      <Box className="row-actions" sx={{ position: 'relative', opacity: menuAnchor ? 1 : 0, transition: 'opacity 0.15s' }}>
        <IconButton size="small" aria-label={t('studio.conversation.actions')} onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ width: 24, height: 24 }}>
          <MoreHorizRounded sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
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
