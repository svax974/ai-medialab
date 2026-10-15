/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render of the chat model badges (no DOM).
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

import { ThemeProvider } from '@mui/material/styles'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { ModelInfo } from '../types'
import { LlmBadges } from './ModelBadges'

for (const dir of ['modules/model-catalog', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const caps = { context_default: 16384, context_max: 131072, vision: false, tools: false, reasoning: 'none', moe: false, params_b: 8, active_params_b: null }
const render = (llm: unknown) => renderToString(createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(LlmBadges, { model: { llm } as unknown as ModelInfo }))).replace(/<!-- -->/g, '')

describe('LlmBadges', () => {
  it('shows the size in parameters and the maximum context', () => {
    const html = render(caps)
    expect(html).toContain('8 Md')
    expect(html).toContain('contexte 128 k')
    expect(html).not.toContain('vision')
    expect(html).not.toContain('outils')
  })

  it('shows what the model can do: vision, tools, thinking', () => {
    const html = render({ ...caps, vision: true, tools: true, reasoning: 'levels' })
    expect(html).toContain('vision')
    expect(html).toContain('outils')
    expect(html).toContain('raisonnement (niveaux)')
  })

  it('shows a mixture of experts with its active parameters', () => {
    expect(render({ ...caps, moe: true, params_b: 30, active_params_b: 3 })).toContain('MoE 30 Md · 3 Md actifs')
  })

  it('draws nothing for a model without chat capabilities', () => {
    expect(render(null)).toBe('')
  })
})
