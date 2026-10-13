/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { periodLabelKey, type PeriodKey } from '../lib/periods'
import { STUDIO_ROUTES } from '../lib/routes'

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `locales.${lang}.json`), 'utf8'))
const fr = load('fr')
const en = load('en')

describe('studio-shell locales', () => {
  it('fr and en define the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
  })

  it('has no empty text', () => {
    for (const [key, value] of [...Object.entries(fr), ...Object.entries(en)]) expect(value.trim(), key).not.toBe('')
  })

  it('keeps the same placeholders in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
  })

  it('defines the title key of every route and the label key of every period', () => {
    for (const route of STUDIO_ROUTES) expect(fr[route.titleKey], route.titleKey).toBeDefined()
    const periods: PeriodKey[] = [{ kind: 'pinned' }, { kind: 'today' }, { kind: 'yesterday' }, { kind: 'last7' }, { kind: 'last30' }]
    for (const period of periods) expect(fr[periodLabelKey(period) as string]).toBeDefined()
  })
})
