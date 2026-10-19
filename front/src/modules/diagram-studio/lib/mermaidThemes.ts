/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { DiagramTheme } from '../types'

/** What `mermaid.initialize()` takes for a theme preset. Applied at render time only: the stored Mermaid source
 * never bakes a theme in, so re-rendering with a different preset later needs no new call to the model. */
export interface MermaidThemeConfig {
  theme: 'default' | 'dark' | 'base'
  themeVariables?: Record<string, string>
}

const VIVID_VARIABLES = {
  primaryColor: '#7c4dff',
  primaryTextColor: '#ffffff',
  primaryBorderColor: '#5e35b1',
  lineColor: '#ff6f61',
  secondaryColor: '#00bfa5',
  tertiaryColor: '#ffd54f',
}

const MINIMAL_VARIABLES = {
  primaryColor: '#f5f5f5',
  primaryTextColor: '#212121',
  primaryBorderColor: '#9e9e9e',
  lineColor: '#9e9e9e',
  secondaryColor: '#ffffff',
  tertiaryColor: '#ffffff',
}

export const MERMAID_THEMES: Record<DiagramTheme, MermaidThemeConfig> = {
  light: { theme: 'default' },
  dark: { theme: 'dark' },
  vivid: { theme: 'base', themeVariables: VIVID_VARIABLES },
  minimal: { theme: 'base', themeVariables: MINIMAL_VARIABLES },
}
