/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { useThemeMode } from '@/modules_shared/common/components/ui/theme/ThemeModeProvider'
import { visualThemeService } from '@/modules_shared/common/theme/VisualThemeService'
import { resolveMuiTheme } from './muiThemes'
import { readStoredMode, storeMode } from './modeStorage'

function subscribeToVisualTheme(onChange: () => void): () => void {
  return visualThemeService.subscribe(onChange)
}

/**
 * Applies the MUI theme of the active visual theme (component overrides included) on top of the palette-only theme
 * that ThemeModeProvider builds from CSS variables. Also restores and persists the light/dark choice: dark by default,
 * light only when explicitly chosen (same rule and storage key as the former interface).
 */
export function AppMuiTheme({ children }: { children: ReactNode }) {
  const { mode, setMode } = useThemeMode()
  const themeId = useSyncExternalStore(subscribeToVisualTheme, () => visualThemeService.getActive().id)
  const theme = useMemo(() => resolveMuiTheme(themeId, mode), [themeId, mode])

  // Before the first paint: ThemeModeProvider starts in dark, the stored choice may be light.
  useLayoutEffect(() => {
    const stored = readStoredMode()
    if (stored !== mode) setMode(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once, on mount
  }, [])

  useEffect(() => {
    storeMode(mode)
    document.documentElement.style.colorScheme = mode
  }, [mode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
