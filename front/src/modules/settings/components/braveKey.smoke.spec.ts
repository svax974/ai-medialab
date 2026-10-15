/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render of the Brave Search key field (no DOM): a password field, never the key, and what it says about storage.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fr = vi.hoisted(() => ({ texts: {} as Record<string, string> }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({
  i18n: {
    get: (key: string, params?: (string | number)[]) => (fr.texts[key] ?? key).replace(/\{(\d+)\}/g, (_m, i) => String(params?.[Number(i)] ?? '')),
    getLang: () => 'fr',
    addEventListener: () => 0,
    removeEventListerner: () => undefined,
  },
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import { settingsKeys } from '../lib/settingsConfig'
import { BraveKeyField } from './BraveKeyField'

for (const dir of ['modules/settings', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

function render(hasKey?: boolean): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (hasKey !== undefined) client.setQueryData(settingsKeys.settings, { keep_alive_minutes: 10, previews: true, low_memory: true, has_hf_token: false, has_brave_api_key: hasKey, quantize: {}, variant: {} })
  return renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(BraveKeyField)))).replace(/<!-- -->/g, '')
}

describe('BraveKeyField', () => {
  it('is a password field that says the key is stored locally, encrypted', () => {
    const html = render(false)
    expect(html).toContain('Clé Brave Search')
    expect(html).toContain('type="password"')
    expect(html).toContain('stockée localement, chiffrée')
    expect(html).not.toContain('Retirer')
    expect(html).not.toMatch(/settings\.[a-zA-Z]+\.[a-zA-Z]/)
  })

  it('says a key is saved and offers to remove it, without ever showing it', () => {
    const html = render(true)
    expect(html).toContain('Une clé est enregistrée.')
    expect(html).toContain('Retirer')
    expect(html).not.toContain('value="BSA')
  })
})
