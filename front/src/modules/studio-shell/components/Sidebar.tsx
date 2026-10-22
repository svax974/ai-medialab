/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box } from '@mui/material'
import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import MenuOpenRounded from '@mui/icons-material/MenuOpenRounded'
import MicNoneOutlined from '@mui/icons-material/MicNoneOutlined'
import VideoLibraryOutlined from '@mui/icons-material/VideoLibraryOutlined'
import { useLocation } from 'react-router-dom'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { matchStudioRoute, studioPaths, type StudioRouteName } from '../lib/routes'
import { SHORTCUT_LABELS } from '../lib/shortcuts'
import { useT } from '../hooks/useT'
import { useStudioStore } from '../state/studioStore'
import type { StudioMode } from '../types'
import { ConversationList } from './ConversationList'
import { Mark } from './Mark'
import { ModeSwitch } from './ModeSwitch'
import { NavItem } from './NavItem'
import { SearchField } from './SearchField'
import { SidebarFooter } from './SidebarFooter'

export const SIDEBAR_WIDTH = 284

interface NavEntry {
  route: StudioRouteName
  to: string
  labelKey: string
  icon: React.ReactNode
  kbd?: string
}

const icon = { fontSize: 16 }

const NAV: Record<StudioMode, NavEntry[]> = {
  image: [
    { route: 'home', to: studioPaths.home, labelKey: 'studio.nav.newImage', icon: <EditNoteRounded sx={icon} />, kbd: SHORTCUT_LABELS.newCreation },
    { route: 'gallery', to: studioPaths.gallery, labelKey: 'studio.nav.gallery', icon: <CollectionsOutlined sx={icon} /> },
  ],
  video: [
    { route: 'video-home', to: studioPaths.videoHome, labelKey: 'studio.nav.newVideo', icon: <EditNoteRounded sx={icon} />, kbd: SHORTCUT_LABELS.newCreation },
    { route: 'video-library', to: studioPaths.videoLibrary, labelKey: 'studio.nav.library', icon: <VideoLibraryOutlined sx={icon} /> },
  ],
  chat: [
    { route: 'chat-home', to: studioPaths.chatHome, labelKey: 'studio.nav.newChat', icon: <EditNoteRounded sx={icon} />, kbd: SHORTCUT_LABELS.newCreation },
  ],
  diagram: [
    { route: 'diagram-home', to: studioPaths.diagramHome, labelKey: 'studio.nav.newDiagram', icon: <EditNoteRounded sx={icon} />, kbd: SHORTCUT_LABELS.newCreation },
  ],
  audio: [
    { route: 'audio-home', to: studioPaths.audioHome, labelKey: 'studio.nav.newAudio', icon: <EditNoteRounded sx={icon} />, kbd: SHORTCUT_LABELS.newCreation },
    { route: 'voices', to: studioPaths.voices, labelKey: 'studio.nav.voices', icon: <MicNoneOutlined sx={icon} /> },
    { route: 'audio-library', to: studioPaths.audioLibrary, labelKey: 'studio.nav.library', icon: <VideoLibraryOutlined sx={icon} /> },
  ],
}

/** Left panel: brand, mode switch, mode pages, conversation search and list, models / settings / theme. */
export function Sidebar() {
  const t = useT()
  const { pathname } = useLocation()
  const mode = useStudioStore((s) => s.mode)
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar)
  const [query, setQuery] = useState('')
  const current = matchStudioRoute(pathname)?.route.name

  return (
    <Box
      component="aside"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        width: SIDEBAR_WIDTH,
        height: '100%',
        borderRight: '1px solid var(--line)',
        backgroundColor: 'var(--bg-elev)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', height: 56, px: 2 }}>
        <Mark />
        <Box component="span" sx={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, lineHeight: 1, letterSpacing: '-0.025em', color: 'var(--ink)' }}>
          {i18n.get('custom.app.name')}
        </Box>
        <Box sx={{ flex: 1 }} />
        <TipIconButton labelId="studio.sidebar.hide" kbd={SHORTCUT_LABELS.toggleSidebar} tipSide="right" onClick={toggleSidebar} sx={{ borderRadius: '8px', width: 28, height: 28 }}>
          <MenuOpenRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>

      <ModeSwitch />

      <Box sx={{ display: 'grid', gap: '4px', px: 1.5 }}>
        {NAV[mode].map((entry) => (
          <NavItem key={entry.route} to={entry.to} active={current === entry.route} icon={entry.icon} label={t(entry.labelKey)} kbd={entry.kbd} />
        ))}
      </Box>

      <SearchField onSearch={setQuery} />
      <ConversationList mode={mode} query={query} />
      <SidebarFooter />
    </Box>
  )
}
