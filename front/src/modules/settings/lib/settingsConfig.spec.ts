/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEEP_ALIVE_OPTIONS, SETTINGS_HELP, SHORTCUT_ROWS } from './settingsConfig'

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `../locales/locales.${lang}.json`), 'utf8'))
const fr = load('fr')
const en = load('en')

describe('settings locales', () => {
  it('fr and en define the same keys, none empty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    for (const [key, value] of [...Object.entries(fr), ...Object.entries(en)]) expect(value.trim(), key).not.toBe('')
  })

  it('keeps the same placeholders in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
  })

  it('defines every key the configuration refers to', () => {
    const ids = [
      ...KEEP_ALIVE_OPTIONS.map((o) => o.labelId),
      ...SHORTCUT_ROWS.map((r) => r.labelId),
      ...Object.values(SETTINGS_HELP).flatMap((h) => Object.values(h)),
    ]
    for (const id of ids) expect(fr[id], id).toBeDefined()
  })
})

describe('keep-alive options', () => {
  it('offers right away, 5, 10, 30 minutes and never, as the old interface did', () => {
    expect(KEEP_ALIVE_OPTIONS.map((o) => o.value)).toEqual([0, 5, 10, 30, -1])
  })
})
