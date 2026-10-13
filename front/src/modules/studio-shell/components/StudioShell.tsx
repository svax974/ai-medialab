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
import { EnginesPanel, startSetup, useEnginesSync } from '@/modules/engines'
import { ModelsDialog, useDownloadEvents } from '@/modules/model-catalog'
import { SettingsDialog } from '@/modules/settings'
import { Sidebar } from './Sidebar'

/**
 * Layout of the studio: the sidebar (hideable, Cmd+B) and the page. Mounted once above the routes, so the list and
 * the search survive navigation. Also hosts the shortcuts, the mode follow-up, the engine event subscription and the
 * dialogs (settings: module `settings`; models: module `model-catalog`, with the installers of module `engines`).
 */
export function StudioShell({ children }: { children: ReactNode }) {
  useShortcuts()
  useModeSync()
  useEngineEventSync()
  useDownloadEvents()
  useEnginesSync()
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
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ModelsDialog
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        onSetup={(model) => void startSetup(model)}
        renderEngines={(kind, models) => <EnginesPanel kind={kind} models={models} />}
      />
      <ConfirmHost />
    </Box>
  )
}
