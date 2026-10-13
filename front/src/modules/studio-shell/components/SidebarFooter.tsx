/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import TuneRounded from '@mui/icons-material/TuneRounded'
import ViewInArOutlined from '@mui/icons-material/ViewInArOutlined'
import { useThemeMode } from '@/modules_shared/common/components/ui/theme/ThemeModeProvider'
import { SwitchLanguage } from '@/modules_shared/common/components/ui/languages/SwitchLanguage'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useStudioStore } from '../state/studioStore'
import { useT } from '../hooks/useT'

function FooterButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: '10px',
        height: 36,
        width: '100%',
        px: 1.5,
        borderRadius: '12px',
        fontSize: 14,
        fontFamily: 'inherit',
        color: 'var(--ink-2)',
        transition: 'background-color 0.15s, color 0.15s',
        '&:hover': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' },
      }}
    >
      {icon}
      {label}
    </ButtonBase>
  )
}

/** Models and settings (empty dialogs until H4), language and light/dark switch. */
export function SidebarFooter() {
  const t = useT()
  const { mode, toggleMode } = useThemeMode()
  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen)
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  const isDark = mode === 'dark'

  return (
    <Box sx={{ display: 'grid', gap: 1, borderTop: '1px solid var(--line)', p: 1.5 }}>
      {/* The engine card (state, loaded model) joins here with the image studio. */}
      <FooterButton icon={<ViewInArOutlined sx={{ fontSize: 16 }} />} label={t('studio.footer.models')} onClick={() => setModelsOpen(true)} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Box sx={{ flex: 1 }}>
          <FooterButton icon={<TuneRounded sx={{ fontSize: 16 }} />} label={t('studio.footer.settings')} onClick={() => setSettingsOpen(true)} />
        </Box>
        <SwitchLanguage />
        <TipIconButton
          labelId={isDark ? 'studio.footer.themeLight' : 'studio.footer.themeDark'}
          onClick={toggleMode}
          sx={{ borderRadius: '8px', width: 36, height: 36 }}
        >
          {isDark ? <LightModeOutlined sx={{ fontSize: 16 }} /> : <DarkModeOutlined sx={{ fontSize: 16 }} />}
        </TipIconButton>
      </Box>
    </Box>
  )
}
