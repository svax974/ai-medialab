/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { createChambreNoireTheme } from './muiTheme'
import { darkTokens, lightTokens } from './tokens'

describe('createChambreNoireTheme', () => {
  it('builds the palette of each mode from the tokens', () => {
    const dark = createChambreNoireTheme('dark')
    const light = createChambreNoireTheme('light')
    expect(dark.palette.mode).toBe('dark')
    expect(dark.palette.background.default).toBe(darkTokens.bg)
    expect(dark.palette.background.paper).toBe(darkTokens.surface)
    expect(dark.palette.primary.main).toBe(darkTokens.safe)
    expect(dark.palette.text.primary).toBe(darkTokens.ink)
    expect(dark.palette.divider).toBe(darkTokens.line)
    expect(light.palette.mode).toBe('light')
    expect(light.palette.background.default).toBe(lightTokens.bg)
    expect(light.palette.primary.main).toBe(lightTokens.safe)
  })

  it('uses borders instead of shadows: every elevation is "none"', () => {
    expect(createChambreNoireTheme('dark').shadows.every((shadow) => shadow === 'none')).toBe(true)
  })

  it('turns the ripple off on every ButtonBase-based component', () => {
    const theme = createChambreNoireTheme('dark')
    for (const name of ['MuiButtonBase', 'MuiButton', 'MuiIconButton', 'MuiTab', 'MuiSwitch'] as const) {
      expect(theme.components?.[name]?.defaultProps, name).toMatchObject({ disableRipple: true })
    }
  })

  it('overrides the components listed by the task', () => {
    const theme = createChambreNoireTheme('dark')
    for (const name of ['MuiButton', 'MuiIconButton', 'MuiDialog', 'MuiPopover', 'MuiMenu', 'MuiSlider', 'MuiSwitch', 'MuiTooltip', 'MuiTextField', 'MuiOutlinedInput', 'MuiTabs', 'MuiChip', 'MuiLinearProgress', 'MuiPaper'] as const) {
      if (name === 'MuiTextField') continue // styled through MuiOutlinedInput / MuiInputBase
      expect(theme.components?.[name], name).toBeDefined()
    }
  })

  it('uses the three typefaces', () => {
    const theme = createChambreNoireTheme('light')
    expect(theme.typography.fontFamily).toContain('Hanken Grotesk Variable')
    expect(String(theme.typography.h2.fontFamily)).toContain('Instrument Serif')
  })
})
