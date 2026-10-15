/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render (no DOM) of the rows and sections of the dialog in each state, to catch runtime errors and raw locale keys.
// Not a visual check, and no interaction. The dialog itself reads stores and a query: its logic is in `lib/` (tested there).
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

import { ThemeProvider } from '@mui/material/styles'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { UpdateItem } from '../types'
import { UpdateRow, type UpdateRowProps } from './UpdateRow'
import { UpdateSection } from './UpdateSection'

for (const dir of ['modules/updates', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const render = (node: ReactElement): string => renderToString(createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, node))
const item = (status: UpdateItem['status'], error: string | null = null): UpdateItem => ({ key: 'model:m', kind: 'model', id: 'm', name: 'Modèle', target: 'pinned', status, error })
const row = (extra: Partial<UpdateRowProps> = {}): string =>
  render(createElement(UpdateRow, { name: 'Modèle', kinds: ['image'], state: 'update', remark: '2 fichier(s) modifié(s)', item: undefined, progress: null, onUpdate: () => undefined, ...extra }))

describe('UpdateRow', () => {
  it('offers the update of a model that has one, with its kind', () => {
    const html = row()
    for (const text of ['Mettre à jour', 'image', '2 fichier(s) modifié(s)']) expect(html).toContain(text)
    expect(html).not.toContain('updates.')
  })

  it('says a current one is up to date and a failed check could not be done', () => {
    expect(row({ state: 'current', remark: 'À jour.' })).toContain('À jour')
    expect(row({ state: 'error', remark: 'Impossible de joindre Hugging Face.' })).toContain('Vérification impossible')
  })

  it('shows the waiting, running (with its bytes), done and failed states', () => {
    expect(row({ item: item('queued') })).toContain('En attente')
    const running = row({ item: item('running'), progress: { done: 5 << 20, total: 10 << 20, rate: 1 << 20 } })
    for (const text of ['Mise à jour…', 'role="progressbar"']) expect(running).toContain(text)
    expect(row({ item: item('done') })).toContain('Mis à jour')
    const failed = row({ item: item('error', 'Espace disque insuffisant.') })
    for (const text of ['Espace disque insuffisant.', 'Réessayer']) expect(failed).toContain(text)
  })

  it('shows the step of a pack, which has no byte count', () => {
    expect(row({ item: item('running'), progress: { done: 0, total: 0, message: 'Installation des bibliothèques' } })).toContain('Installation des bibliothèques')
  })
})

describe('UpdateRow secondary actions', () => {
  const actions = [
    { key: 'latest', label: 'Mettre à jour vers la dernière version (non testée)', onClick: () => undefined, note: 'La version master-999 n\'a pas été testée.', tone: 'caution' as const },
    { key: 'rollback', label: 'Revenir à la version testée (master-956)', onClick: () => undefined, note: 'Plus récente que la version testée.', tone: 'plain' as const },
  ]

  it('shows each action with its warning, and the adviser text when there is one', () => {
    const html = row({ state: 'current', remark: 'Version installée : master-956.', actions, advice: 'Conseil de test.' })
    for (const text of ['dernière version (non testée)', 'n&#x27;a pas été testée', 'Revenir à la version testée', 'Conseil de test.']) expect(html).toContain(text)
  })

  it('hides them while the row is waiting, running or done, and shows them again after a failure', () => {
    for (const status of ['queued', 'running', 'done'] as const) expect(row({ state: 'current', item: item(status), actions })).not.toContain('Revenir à la version testée')
    expect(row({ state: 'current', item: item('error', 'Échec.'), actions })).toContain('Revenir à la version testée')
  })
})

describe('UpdateSection', () => {
  it('shows the update-all button with its count, and no button when nothing is pending', () => {
    const section = (pending: number) => render(createElement(UpdateSection, { title: 'Modèles installés', allLabel: `Mettre à jour les modèles (${pending})`, pending, onUpdateAll: () => undefined, empty: 'Aucun modèle installé.', children: [] }))
    expect(section(3)).toContain('Mettre à jour les modèles (3)')
    expect(section(0)).not.toContain('Mettre à jour les modèles')
    expect(section(0)).toContain('Aucun modèle installé.')
  })
})
