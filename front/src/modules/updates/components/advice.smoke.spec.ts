/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render (no DOM) of the adviser's pieces in each state, to catch runtime errors and raw locale keys. Not a visual check.
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
import type { LocalAiSetup } from '@/modules/engines'
import type { AdviceJob } from '../lib/adviceQueue'
import type { UpdateAdvisory } from '../types'
import { AdviceBlock } from './AdviceBlock'
import { AdviceSlot } from './AdviceSlot'
import { LocalAiInvite } from './LocalAiInvite'
import { SavedAdvisories } from './SavedAdvisories'

for (const dir of ['modules/updates', 'modules/engines', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const render = (node: ReactElement): string => renderToString(createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, node))

const advice = (over: Partial<UpdateAdvisory> = {}): UpdateAdvisory => ({
  id: 'a1', kind: 'engine', item_id: 'sdcpp', from_version: 'master-900', to_version: 'master-1002', verdict: 'discouraged', summary: 'Un plantage est signalé au chargement de Wan.',
  findings: [
    { severity: 'info', title: 'Nouveau sampler', quote: 'added a new sampler for LTX', url: 'https://gh/r/1', source_kind: 'release' },
    { severity: 'critical', title: 'Plantage au chargement', quote: 'It crashes on load since master-1002', url: 'https://gh/i/7', source_kind: 'issue' },
    { severity: 'critical', title: 'Fuite mémoire', quote: 'Fuite mémoire', url: '', source_kind: 'known' },
  ],
  sources: [{ title: 'Issue #7', url: 'https://gh/i/7' }], notes: ['Issues non lues : limite de l\'API GitHub atteinte.'], llm_model_id: 'llm-qwen3-4b-instruct-2507', created_at: 1_760_000_000, stale: false, ...over,
})

const job = (status: AdviceJob['status'], error: string | null = null): AdviceJob => ({ key: 'k', kind: 'engine', id: 'sdcpp', name: 'sd.cpp', target: 'pinned', status, error, code: null })

describe('AdviceBlock', () => {
  it('shows the verdict, the summary, the findings with their excerpts and links, and that the advice is automatic', () => {
    const html = render(createElement(AdviceBlock, { advice: advice(), onRerun: () => undefined, onForget: () => undefined }))
    for (const text of ['Déconseillé par l&#x27;analyse', 'Un plantage est signalé', '3 constat(s)', 'It crashes on load since master-1002', 'href="https://gh/i/7"', 'rel="noopener noreferrer"',
      'Régression documentée dans ce dépôt', 'llm-qwen3-4b-instruct-2507', 'Avis automatique, à vérifier.', 'Relancer l&#x27;analyse', 'Oublier cet avis', 'À noter']) {
      expect(html, text).toContain(text)
    }
    expect(html).not.toContain('updates.')
  })

  it('puts the most serious finding first', () => {
    const html = render(createElement(AdviceBlock, { advice: advice() }))
    expect(html.indexOf('Plantage au chargement')).toBeLessThan(html.indexOf('Nouveau sampler'))
  })

  it('says so when the advice is about another version, and shows the calm verdicts calmly', () => {
    expect(render(createElement(AdviceBlock, { advice: advice({ stale: true }) }))).toContain('relancez l&#x27;analyse')
    const none = render(createElement(AdviceBlock, { advice: advice({ verdict: 'none', findings: [], notes: [], summary: 'Aucun problème signalé dans les 5 source(s) consultée(s).' }) }))
    expect(none).toContain('Rien de notable')
    expect(none).not.toContain('constat(s)')
    expect(render(createElement(AdviceBlock, { advice: advice({ verdict: 'caution' }) }))).toContain('À surveiller')
  })
})

describe('AdviceSlot', () => {
  const slot = (props: Partial<Parameters<typeof AdviceSlot>[0]> = {}) => render(createElement(AdviceSlot, { advice: null, job: undefined, canAnalyse: true, onAnalyse: () => undefined, ...props }))

  it('offers the analysis when there is none, only when a local model is ready', () => {
    expect(slot()).toContain('Analyser les risques (IA locale)')
    expect(slot({ canAnalyse: false })).not.toContain('Analyser les risques')
  })

  it('shows the analysis waiting or running, and its failure with a way to try again', () => {
    expect(slot({ job: job('queued') })).toContain('Analyse en attente')
    expect(slot({ job: job('running') })).toContain('Analyse en cours')
    expect(slot({ job: job('running') })).not.toContain('Analyser les risques')
    const failed = slot({ job: job('error', 'Une génération est en cours.') })
    for (const text of ['Analyse impossible : Une génération est en cours.', 'Réessayer']) expect(failed).toContain(text)
  })

  it('shows the advice, with the way to run the analysis again unless one is running', () => {
    expect(slot({ advice: advice() })).toContain('Relancer l&#x27;analyse')
    expect(slot({ advice: advice(), job: job('running') })).not.toContain('Relancer l&#x27;analyse')
  })
})

describe('LocalAiInvite', () => {
  const setup = (over: Partial<LocalAiSetup> = {}): LocalAiSetup => ({
    state: 'needs-setup', modelId: 'llm-qwen3-4b-instruct-2507', modelName: 'Qwen3 4B Instruct 2507', engineInstalled: false, modelInstalled: false, engineSizeMb: 11, modelSizeGb: 2.33,
    neededGb: 2.34, freeGb: 100, progress: null, error: null, start: async () => undefined, cancel: async () => undefined, ...over,
  })
  const invite = (over: Partial<LocalAiSetup> = {}) => render(createElement(LocalAiInvite, { setup: setup(over) }))

  it('invites to install the adviser with its size, and says that nothing blocks an update', () => {
    const html = invite()
    for (const text of ['Analyser les risques des mises à jour (IA locale)', 'Installer le conseiller', 'moteur ≈ 11 Mo', 'Qwen3 4B Instruct 2507', 'ne bloque jamais']) expect(html, text).toContain(text)
    expect(html).not.toContain('updates.')
  })

  it('says why it cannot start when the disk is too small, and disables the button', () => {
    const html = invite({ state: 'no-space', freeGb: 1.5 })
    expect(html).toContain('Espace disque insuffisant')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Installer le conseiller/)
  })

  it('shows the progress of the install instead of the button, and the error of a failed one', () => {
    const running = invite({ state: 'downloading', progress: { step: 'model', done: 5 << 20, total: 10 << 20, rate: 1 << 20, eta: 10 } })
    expect(running).toContain('Téléchargement du modèle')
    expect(running).toContain('role="progressbar"')
    expect(running).not.toContain('Installer le conseiller')
    expect(invite({ state: 'error', error: 'Archive corrompue' })).toContain('Archive corrompue')
  })

  it('shows nothing once the adviser is ready (or while the machine is still being read)', () => {
    expect(invite({ state: 'ready' })).toBe('')
    expect(invite({ state: 'unknown' })).toBe('')
  })
})

describe('SavedAdvisories', () => {
  it('lists the advice kept from earlier analyses with the update each is about, and says nothing when there are none', () => {
    const html = render(createElement(SavedAdvisories, { advisories: [advice(), advice({ id: 'a2', item_id: 'wan', kind: 'model', to_version: 'f00dfeed1234', from_version: null })], onForget: () => undefined }))
    for (const text of ['Derniers avis enregistrés', 'sdcpp', 'master-900', 'master-1002', '→', 'wan', 'f00dfeed1234']) expect(html, text).toContain(text)
    expect(render(createElement(SavedAdvisories, { advisories: [], onForget: () => undefined }))).toBe('')
  })
})
