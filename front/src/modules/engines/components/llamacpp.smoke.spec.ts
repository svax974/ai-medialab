/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render of the llama.cpp card (no DOM): the install button with its size, the installed state, the error.
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
import type { SystemInfo } from '@/modules/hardware'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import { EnginesPanel } from './EnginesPanel'
import { LlamacppCard } from './LlamacppCard'

for (const dir of ['modules/engines', 'modules/model-catalog', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const system = (llamacpp: unknown) => ({ engines: { llamacpp }, packs: {}, pack_install: { state: 'idle' } }) as unknown as SystemInfo
const render = (element: ReturnType<typeof createElement>) =>
  renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, element))).replace(/<!-- -->/g, '')

describe('llama.cpp card', () => {
  it('offers to install the chat engine with its size', () => {
    const html = render(createElement(LlamacppCard, { system: system({ available: false, installable: true, install_size_mb: 11 }) }))
    expect(html).toContain('Moteur de chat')
    expect(html).toContain('llama.cpp')
    expect(html).toContain('Installer ≈ 11 Mo')
    expect(html).not.toMatch(/engines\.[a-z]+\.[a-z]/)
  })

  it('shows the device of an installed engine (uninstalling is now done from the components manager)', () => {
    const html = render(createElement(LlamacppCard, { system: system({ available: true, variant: 'metal' }) }))
    expect(html).toContain('Metal')
    expect(html).not.toContain('Désinstaller')
    expect(html).not.toContain('Installer ≈')
  })

  it('says why it cannot be installed', () => {
    const html = render(createElement(LlamacppCard, { system: system({ available: false, installable: false, reason: 'Aucune build pour ce système.' }) }))
    expect(html).toContain('Aucune build pour ce système.')
  })

  it('draws nothing when the engine does not report llama.cpp', () => {
    expect(render(createElement(LlamacppCard, { system: { ...system(undefined), engines: {} } as SystemInfo }))).toBe('')
  })

  it('is the panel of the chat tab of the models dialog', () => {
    // The panel reads the machine description from the query cache: without it (loading) it draws nothing.
    expect(render(createElement(EnginesPanel, { kind: 'llm', models: [] }))).toBe('')
  })
})
