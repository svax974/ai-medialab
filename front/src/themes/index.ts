/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

// Side-effect: registers all app themes with the ThemeRegistry singleton.
// Imported once at startup (main.tsx) before VisualThemeProvider mounts.

import { themeRegistry } from '@/modules_shared/common/theme/themes'
import { defaultTheme } from './default'
import { chambreNoireTheme, CHAMBRE_NOIRE_ID } from './chambre-noire'

// `default` stays registered: ThemeRegistry.getDefault() and VisualThemeService fall back to it. It has no CSS of its
// own, and theme.css is scoped to :root, so it looks the same as chambre-noire.
themeRegistry.register(defaultTheme)
themeRegistry.register(chambreNoireTheme)

/**
 * "Default" for this app = chambre-noire. VisualThemeService reads `vx_visual_theme` and falls back to the id `default`,
 * so the preference is seeded once (never overwriting a later explicit choice).
 */
const STORAGE_KEY = 'vx_visual_theme'
try {
  if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, CHAMBRE_NOIRE_ID)
} catch {
  /* storage unavailable: the `default` theme (same look) applies */
}
