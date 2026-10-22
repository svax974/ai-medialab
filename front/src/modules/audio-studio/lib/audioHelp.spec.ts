/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { autoplayHelp, maxCharsHelp } from './audioHelp'

const t = (key: string, params?: (string | number)[]) => `${key}${params ? `(${params.join(',')})` : ''}`

describe('audio help', () => {
  it('tells how many characters the model reads at once, formatted for the language, then why long texts are cut', () => {
    const help = maxCharsHelp(1500, 8000, 'fr', t)
    expect(help.title).toBe('audioStudio.help.maxChars.title')
    expect(String(help.body)).toMatch(/^audioStudio\.help\.maxChars\.lead\(1.500,8.000\) audioStudio\.help\.maxChars\.body$/u)
    expect(help.tip).toBe('audioStudio.help.maxChars.tip')
  })

  it('titles the autoplay tooltip with its state', () => {
    expect(autoplayHelp(true, t).title).toBe('audioStudio.help.autoplay.on')
    expect(autoplayHelp(false, t).title).toBe('audioStudio.help.autoplay.off')
    expect(autoplayHelp(false, t).body).toBe('audioStudio.help.autoplay.body')
  })
})
