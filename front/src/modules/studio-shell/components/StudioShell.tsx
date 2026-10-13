/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import MenuRounded from '@mui/icons-material/MenuRounded'
import { ConfirmHost } from '@/modules_shared/common/components/ui/confirm'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { SHORTCUT_LABELS } from '../lib/shortcuts'
import { useEngineEventSync } from '../hooks/useEngineEventSync'
import { useModeSync } from '../hooks/useModeSync'
import { useShortcuts } from '../hooks/useShortcuts'
import { useStudioStore } from '../state/studioStore'
import { ComingSoonDialog } from './ComingSoonDialog'
import { Sidebar } from './Sidebar'

/**
 * Layout of the studio: the sidebar (hideable, Cmd+B) and the page. Mounted once above the routes, so the list and
 * the search survive navigation. Also hosts the shortcuts, the mode follow-up, the engine event subscription and the
 * dialogs (settings and models: empty until H4.1 / H4.2).
 */
export function StudioShell({ children }: { children: ReactNode }) {
  useShortcuts()
  useModeSync()
  useEngineEventSync()
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar)
  const settingsOpen = useStudioStore((s) => s.settingsOpen)
  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen)
  const modelsOpen = useStudioStore((s) => s.modelsOpen)
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>
      {sidebarOpen && <Sidebar />}
      <Box component="main" sx={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'auto' }}>
        {!sidebarOpen && (
          <Box sx={{ position: 'absolute', left: 12, top: 10, zIndex: 20 }}>
            <TipIconButton labelId="studio.sidebar.show" kbd={SHORTCUT_LABELS.toggleSidebar} tipSide="right" onClick={toggleSidebar} sx={{ borderRadius: '8px' }}>
              <MenuRounded sx={{ fontSize: 16 }} />
            </TipIconButton>
          </Box>
        )}
        {children}
      </Box>
      <ComingSoonDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} titleKey="studio.dialog.settings.title" />
      <ComingSoonDialog open={modelsOpen} onClose={() => setModelsOpen(false)} titleKey="studio.dialog.models.title" />
      <ConfirmHost />
    </Box>
  )
}
