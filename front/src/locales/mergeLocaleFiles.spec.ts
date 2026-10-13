/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { mergeLocaleFiles } from './mergeLocaleFiles'

describe('mergeLocaleFiles', () => {
  it('groups files by language and merges their keys', () => {
    const merged = mergeLocaleFiles({
      '/src/modules/a/locales/locales.fr.json': { 'a.x': 'X' },
      '/src/modules/a/locales/locales.en.json': { 'a.x': 'X-en' },
      '/src/themes/t/locales/locales.fr.json': { 't.y': 'Y' },
    })
    expect(merged).toEqual({ fr: { 'a.x': 'X', 't.y': 'Y' }, en: { 'a.x': 'X-en' } })
  })

  it('ignores files that do not follow the locales.<lang>.json naming', () => {
    expect(mergeLocaleFiles({ '/src/modules/a/locales/other.json': { k: 'v' } })).toEqual({})
  })
})
