/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Theme } from '@mui/material/styles'
import { CHAMBRE_NOIRE_ID } from './chambre-noire'
import { createChambreNoireTheme, type ThemeMode } from './chambre-noire/muiTheme'

/**
 * MUI theme of each registered visual theme. ThemeRegistry (react/common) only knows the CSS side of a theme
 * (`ThemeDefinition`); the MUI component overrides are held here, keyed by the same id. An unknown id (for instance the
 * template's `default`, which relies on the :root variables of theme.css) gets the default theme of the app.
 */
const factories: Record<string, (mode: ThemeMode) => Theme> = {
  [CHAMBRE_NOIRE_ID]: createChambreNoireTheme,
}

export const DEFAULT_VISUAL_THEME_ID = CHAMBRE_NOIRE_ID

export function resolveMuiTheme(themeId: string, mode: ThemeMode): Theme {
  return (factories[themeId] ?? factories[DEFAULT_VISUAL_THEME_ID])(mode)
}
