/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ThemeDefinition } from '@/modules_shared/common/theme/types'
import './theme.css' // side-effect import so Vite bundles the CSS (tokens, fonts, film grain)

/** Id under which the theme is registered and persisted (`vx_visual_theme`). */
export const CHAMBRE_NOIRE_ID = 'chambre-noire'

// The light/dark mode is not part of the definition: it is `data-color-scheme` (ThemeModeProvider).
export const chambreNoireTheme: ThemeDefinition = {
  id: CHAMBRE_NOIRE_ID,
  name: 'studio.theme.chambreNoire.name',
  description: 'studio.theme.chambreNoire.description',
  shell: 'standard',
  interaction: 'standard',
  builtIn: true,
}
