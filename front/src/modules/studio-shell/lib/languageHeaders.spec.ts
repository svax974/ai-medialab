/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { languageHeaders } from './languageHeaders'

describe('languageHeaders', () => {
  it('names the language of the interface', () => {
    i18n.setLang('en', false)
    expect(languageHeaders()).toEqual({ 'Accept-Language': 'en' })
    i18n.setLang('fr', false)
    expect(languageHeaders()).toEqual({ 'Accept-Language': 'fr' })
  })

  it('sends nothing while no language is known', () => {
    i18n.setLang('', false)
    expect(languageHeaders()).toEqual({})
  })
})
