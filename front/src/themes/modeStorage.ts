/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ThemeMode } from './chambre-noire/muiTheme'

/** Same key as the former interface; the anti-flash script of index.html reads it too. */
export const MODE_STORAGE_KEY = 'cn-theme'

/** Dark unless light was explicitly chosen (the system setting is ignored on purpose). */
export function parseMode(value: string | null): ThemeMode {
  return value === 'light' ? 'light' : 'dark'
}

export function readStoredMode(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(MODE_STORAGE_KEY))
  } catch {
    return 'dark'
  }
}

export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    /* storage unavailable: the choice lasts for the session only */
  }
}
