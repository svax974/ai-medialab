/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { AdviceFinding, EngineUpdate, ModelUpdate, UpdateAdvisory, UpdateItem, UpdatesReport } from '../types'
import { adviceForItem, analysisJobs, attachAdvisory, discouragedItems, dropAdvisory, findingsText, isFresh, jobKey, makeJob, sortFindings, verdictTone } from './advice'

const finding = (severity: AdviceFinding['severity'], title: string, quote = ''): AdviceFinding => ({ severity, title, quote, url: 'https://gh/i/1', source_kind: 'issue' })

const advisory = (over: Partial<UpdateAdvisory> = {}): UpdateAdvisory => ({
  id: 'a1', kind: 'engine', item_id: 'sdcpp', from_version: 'master-900', to_version: 'master-956', verdict: 'caution', summary: 'Un point à surveiller.',
  findings: [finding('warning', 'Lent')], sources: [], notes: [], llm_model_id: 'llm-qwen3-4b-instruct-2507', created_at: 1, stale: false, ...over,
})

const engine = (over: Partial<EngineUpdate> = {}): EngineUpdate => ({
  id: 'sdcpp', name: 'stable-diffusion.cpp', kinds: ['image'], state: 'update', installed: 'master-900', target: 'master-956', upstream: 'master-1002',
  latest: { tag: 'master-1002', regressions: [], advice: null }, rollback: false, variant: 'metal', size_mb: 30, reason: 'pinned', advice: null, ...over,
})

const model = (over: Partial<ModelUpdate> = {}): ModelUpdate => ({
  id: 'wan', name: 'Wan', kind: 'video', state: 'update', files: 1, size_gb: 3, error: null, revision: 'abc1234', fingerprint: 'f00dfeed1234', advice: null, ...over,
})

const report = (engines: EngineUpdate[], models: ModelUpdate[] = []): UpdatesReport => ({ engines, models, checked_at: 1 })
const item = (over: Partial<UpdateItem>): UpdateItem => ({ key: 'k', kind: 'engine', id: 'sdcpp', name: 'sd.cpp', target: 'pinned', status: 'queued', error: null, ...over })

describe('analysisJobs', () => {
  it('asks for the tested release, the untested newest one and every model update that has no advice yet', () => {
    const jobs = analysisJobs(report([engine()], [model()]))
    expect(jobs.map((j) => j.key)).toEqual([jobKey('engine', 'sdcpp', 'pinned'), jobKey('engine', 'sdcpp', 'latest'), jobKey('model', 'wan', 'pinned')])
    expect(jobs[1]).toMatchObject({ kind: 'engine', id: 'sdcpp', target: 'latest', name: 'stable-diffusion.cpp master-1002' })
  })

  it('skips what already has an advice about the version on offer, and asks again for a stale one', () => {
    const fresh = advisory()
    const stale = advisory({ stale: true })
    expect(analysisJobs(report([engine({ advice: fresh, latest: null })], [model({ advice: fresh })]))).toEqual([])
    expect(analysisJobs(report([engine({ advice: stale, latest: null })])).map((j) => j.target)).toEqual(['pinned'])
  })

  it('has nothing to say about an engine that is up to date (its newest release is still looked at), a pack, or a failed check', () => {
    expect(analysisJobs(report([engine({ state: 'current', latest: null })], [model({ state: 'error' })]))).toEqual([])
    expect(analysisJobs(report([engine({ state: 'current' })])).map((j) => j.target)).toEqual(['latest'])
    expect(analysisJobs(report([engine({ id: 'video-pack', reason: 'recipe', target: null, latest: null })]))).toEqual([])
  })
})

describe('attachAdvisory', () => {
  it('puts the advice on the row and the slot whose offered version it is about', () => {
    const pinned = advisory({ id: 'p', to_version: 'master-956' })
    const latest = advisory({ id: 'l', to_version: 'master-1002' })
    const base = report([engine()], [model()])
    const afterPinned = attachAdvisory(base, pinned)
    expect(afterPinned.engines[0].advice?.id).toBe('p')
    expect(afterPinned.engines[0].latest?.advice).toBeNull()
    expect(attachAdvisory(afterPinned, latest).engines[0].latest?.advice?.id).toBe('l')
    expect(attachAdvisory(base, advisory({ id: 'm', kind: 'model', item_id: 'wan', to_version: 'f00dfeed1234' })).models[0].advice?.id).toBe('m')
  })

  it('leaves the check alone when no row offers that version, and never mutates it', () => {
    const base = report([engine()], [model()])
    expect(attachAdvisory(base, advisory({ to_version: 'master-1' }))).toEqual(base)
    expect(attachAdvisory(base, advisory({ kind: 'model', item_id: 'wan', to_version: 'other' }))).toEqual(base)
    attachAdvisory(base, advisory())
    expect(base.engines[0].advice).toBeNull()
  })
})

describe('dropAdvisory', () => {
  it('removes a forgotten advice wherever it is attached', () => {
    const a = advisory({ id: 'x' })
    const base = report([engine({ advice: a, latest: { tag: 'master-1002', regressions: [], advice: advisory({ id: 'y' }) } })], [model({ advice: advisory({ id: 'x' }) })])
    const next = dropAdvisory(base, 'x')
    expect(next.engines[0].advice).toBeNull()
    expect(next.engines[0].latest?.advice?.id).toBe('y')
    expect(next.models[0].advice).toBeNull()
    expect(dropAdvisory(next, 'y').engines[0].latest?.advice).toBeNull()
  })
})

describe('discouraged updates', () => {
  const bad = advisory({ verdict: 'discouraged', findings: [finding('info', 'Note'), finding('critical', 'Plantage au chargement', 'It crashes on load')] })

  it('lists the items whose fresh advice discourages the update, for the tested release and for the latest one alike', () => {
    const rep = report([engine({ advice: bad, latest: { tag: 'master-1002', regressions: [], advice: advisory({ verdict: 'caution' }) } })], [model({ advice: bad })])
    expect(discouragedItems([item({ target: 'pinned' }), item({ target: 'latest', key: 'l' }), item({ kind: 'model', id: 'wan', name: 'Wan', key: 'm' })], rep).map((d) => d.name)).toEqual(['sd.cpp', 'Wan'])
  })

  it('ignores a stale advice and the items it knows nothing about, and never needs a report', () => {
    expect(discouragedItems([item({})], report([engine({ advice: { ...bad, stale: true } })]))).toEqual([])
    expect(discouragedItems([item({ id: 'nope' })], report([engine({ advice: bad })]))).toEqual([])
    expect(discouragedItems([item({})], undefined)).toEqual([])
    expect(adviceForItem(item({}), undefined)).toBeNull()
  })

  it('quotes the serious findings first, with their excerpts', () => {
    expect(findingsText(bad)).toBe('Plantage au chargement (« It crashes on load »)')
    expect(findingsText(advisory({ findings: [finding('info', 'Seulement une note')] }))).toBe('Seulement une note')
    expect(findingsText(advisory({ findings: [1, 2, 3, 4, 5].map((n) => finding('warning', `P${n}`)) }), 2)).toBe('P1 ; P2')
  })
})

describe('small helpers', () => {
  it('sorts the findings by severity and keeps the engine order within one', () => {
    const sorted = sortFindings([finding('info', 'i'), finding('warning', 'w1'), finding('critical', 'c'), finding('warning', 'w2')])
    expect(sorted.map((f) => f.title)).toEqual(['c', 'w1', 'w2', 'i'])
  })

  it('maps verdicts to tones, freshness and job identity', () => {
    expect([verdictTone('none'), verdictTone('caution'), verdictTone('discouraged')]).toEqual(['ok', 'warn', 'danger'])
    expect([isFresh(null), isFresh(advisory()), isFresh(advisory({ stale: true })), isFresh(advisory({ stale: null }))]).toEqual([false, true, false, true])
    expect(makeJob('model', 'wan', 'Wan', 'pinned')).toEqual({ key: 'advice:model:wan:pinned', kind: 'model', id: 'wan', name: 'Wan', target: 'pinned' })
  })
})
