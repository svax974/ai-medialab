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
import { useT } from '../hooks/useT'
import { useShortcuts } from '../hooks/useShortcuts'
import { useStudioStore } from '../state/studioStore'
import { EnginesPanel, LocalAiLaunchDialog, SetupDialog, startSetup, useEnginesSync } from '@/modules/engines'
import { ModelsDialog, useDownloadEvents } from '@/modules/model-catalog'
import { SettingsDialog } from '@/modules/settings'
import { useLlmEvents } from '@/modules/chat/hooks/useLlmEvents'
import { UpdatesDialog, useUpdatesPrefs, useUpdateRunner } from '@/modules/updates'
import { PrivateBanner, PrivateHost, usePrivateStore } from '@/modules/private'
import { ImageDropLayer } from '@/modules/image-studio'
import { useVoiceEvents, VoiceDropLayer, VoiceStudioDialog } from '@/modules/voices'
import { VideoDropLayer, VideoViewerActions } from '@/modules/video-studio'
import { StudioLightbox, useStudioEvents, type ViewerModeActions } from '@/modules/studio-core'
import { Sidebar } from './Sidebar'

/** What the viewer offers per mode in place of "use as reference". */
const VIEWER_ACTIONS: ViewerModeActions = { video: VideoViewerActions }

/**
 * Layout of the studio: the sidebar (hideable, Cmd+B) and the page. Mounted once above the routes, so the list and
 * the search survive navigation. Also hosts the shortcuts, the mode follow-up, the `engine.*`, `studio.*`, chat-model (`engine.llm.status`) and voice-library event subscriptions and the
 * dialogs (settings: module `settings`; models: module `model-catalog`, with the installers of module `engines`; updates: module `updates`, whose runner goes on when the dialog is closed), the media
 * viewer, the window drop of images (image mode), of a voice sample (audio mode) and of images and videos (video mode), and the voice studio dialog.
 */
export function StudioShell({ children }: { children: ReactNode }) {
  useShortcuts()
  useModeSync()
  useEngineEventSync()
  useStudioEvents()
  useDownloadEvents()
  useEnginesSync()
  useUpdateRunner()
  useVoiceEvents()
  useLlmEvents()
  const mode = useStudioStore((s) => s.mode)
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen)
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar)
  const settingsOpen = useStudioStore((s) => s.settingsOpen)
  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen)
  const modelsOpen = useStudioStore((s) => s.modelsOpen)
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  const t = useT()
  const setAutoAdvice = useUpdatesPrefs((s) => s.setAutoAdvice)
  const privateActive = usePrivateStore((s) => s.active)

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
        <PrivateBanner />
        {children}
      </Box>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SetupDialog />
      <ModelsDialog
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        onSetup={(model) => startSetup(model)}
        renderEngines={(kind, models) => <EnginesPanel kind={kind} models={models} />}
      />
      <UpdatesDialog />
      <LocalAiLaunchDialog suppressed={privateActive} extraOption={{ label: t('engines.localAi.launch.autoAdvice'), defaultChecked: true, onApply: setAutoAdvice }} />
      <StudioLightbox modeActions={VIEWER_ACTIONS} />
      {mode === 'image' && <ImageDropLayer />}
      {mode === 'audio' && <VoiceDropLayer />}
      {mode === 'video' && <VideoDropLayer />}
      <VoiceStudioDialog />
      <ConfirmHost />
      <PrivateHost />
    </Box>
  )
}
