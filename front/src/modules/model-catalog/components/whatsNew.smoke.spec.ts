/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Smoke test of « What's new »: server-side render (no DOM) of one row in each state and of the button, to catch runtime
// errors and raw locale keys. The dialog itself opens in a portal: it is checked by hand, not here.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactElement } from 'react'
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
import { MemoryRouter } from 'react-router-dom'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { TrendingEntry } from '../types'
import { WhatsNewButton } from './WhatsNewButton'
import { WhatsNewRow } from './WhatsNewRow'

for (const dir of ['studio-core', 'studio-shell', 'model-catalog', 'hardware']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src/modules', dir, 'locales/locales.fr.json'), 'utf8')))
}

const entry = (over: Partial<TrendingEntry> = {}): TrendingEntry => ({
  repo: 'acme/Z-Image-Turbo-GGUF', name: 'Z Image Turbo GGUF', author: 'acme', family: 'gguf-variant', family_label: 'GGUF', task: 'image',
  created_at: '2026-10-03T00:00:00Z', age_days: 12, downloads: 1_150_000, likes: 404, trending_score: 36, license: 'apache-2.0', license_note: null,
  compatible: true, reason: '', options: 4, url: 'https://huggingface.co/acme/Z-Image-Turbo-GGUF',
  option: { key: 'z-Q4_K_M.gguf', label: 'Q4_K_M', precision: 'Q4_K_M', size_gb: 4.5, download_gb: 6.1, fits: true, fit_note: null }, ...over,
})

function render(element: ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/models\.new\.[a-z]/)

describe("What's new renders without error and without raw keys", () => {
  it('shows a model with its facts, the proposed variant, the add action and the variants', () => {
    const html = render(createElement(WhatsNewRow, { entry: entry(), isNew: true }))
    expect(html).toContain('Z Image Turbo GGUF')
    expect(html).toContain('acme')
    expect(html).toContain('nouveau')
    expect(html).toContain('Q4_K_M')
    expect(html).toContain('≈ 6,1 Go') // what adding downloads (the file and the shared files still missing)
    expect(html).toContain('il y a 12 j')
    expect(html).toContain('1,2 M téléch. / 30 j')
    expect(html).toContain('404 j&#x27;aime')
    expect(html).toContain('apache-2.0')
    expect(html).toContain('Ajouter')
    expect(html).toContain('Variantes (4)')
    expect(html).toContain('https://huggingface.co/acme/Z-Image-Turbo-GGUF')
    noRawKeys(html)
  })

  it('flags a licence that is not plainly open and a model too heavy for the machine', () => {
    const html = render(createElement(WhatsNewRow, { entry: entry({ license_note: 'noncommercial', license: 'cc-by-nc-4.0', compatible: false, reason: 'Il faut ≈ 30 Go de mémoire (16 Go ici).', options: 1 }), isNew: false }))
    expect(html).toContain('non commercial')
    expect(html).toContain('trop lourd')
    expect(html).toContain('Il faut ≈ 30 Go de mémoire')
    expect(html).not.toContain('nouveau')
    expect(html).not.toContain('Variantes (') // one variant only: nothing to choose
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Ajouter/s) // the add action is off
    noRawKeys(html)
  })

  it('shows the button of a page with its label, and no dot before the list is read', () => {
    const html = render(createElement(WhatsNewButton, { kind: 'audio' }))
    expect(html).toContain('Nouveautés')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('depuis votre dernière visite')
    noRawKeys(html)
  })
})
