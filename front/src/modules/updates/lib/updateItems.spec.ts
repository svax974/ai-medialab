/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { EngineUpdate, ModelUpdate, UpdateItem, UpdatesReport } from '../types'
import { outcomeOf, pendingItems, progressOf, toEngineItem, visibleRows, type InstallContext } from './updateItems'

const engine = (id: string, state: EngineUpdate['state'], kinds: EngineUpdate['kinds'] = ['image']): EngineUpdate => ({
  id, name: id, kinds, state, installed: 'v1', target: 'v2', upstream: null, latest: null, rollback: false, variant: null, size_mb: 30, reason: 'pinned', advice: null,
})
const model = (id: string, state: ModelUpdate['state'], kind: ModelUpdate['kind'] = 'image'): ModelUpdate => ({ id, name: id, kind, state, files: state === 'update' ? 2 : 0, size_gb: 1, error: null })
const report: UpdatesReport = {
  engines: [engine('sdcpp', 'update', ['image', 'video']), engine('audiocpp', 'current', ['audio']), engine('kiwi', 'update', ['video'])],
  models: [model('a', 'current'), model('b', 'update'), model('c', 'update', 'audio'), model('d', 'error', 'video')],
  checked_at: 1,
}
const idle: InstallContext = { downloads: {}, engineInstall: { state: 'idle' }, packInstall: { state: 'idle' } }

describe('visibleRows', () => {
  it('lists updates first, then failed checks, then what is current', () => {
    expect(visibleRows(report, 'all').models.map((m) => m.id)).toEqual(['b', 'c', 'd', 'a'])
    expect(visibleRows(report, 'all').engines.map((e) => e.id)).toEqual(['sdcpp', 'kiwi', 'audiocpp'])
  })

  it('narrows both sections to a kind; an engine that serves several kinds is in each', () => {
    expect(visibleRows(report, 'video').engines.map((e) => e.id)).toEqual(['sdcpp', 'kiwi'])
    expect(visibleRows(report, 'audio').models.map((m) => m.id)).toEqual(['c'])
    expect(visibleRows(report, 'image').engines.map((e) => e.id)).toEqual(['sdcpp'])
  })

  it('is empty before the check answers', () => {
    expect(visibleRows(undefined, 'all')).toEqual({ engines: [], models: [] })
  })
})

describe('pendingItems', () => {
  it('starts only what can be updated, engines before models', () => {
    expect(pendingItems(visibleRows(report, 'all'), []).map((i) => i.key)).toEqual(['engine:sdcpp', 'engine:kiwi', 'model:b', 'model:c'])
  })

  it('can be limited to a section, or to the visible kind', () => {
    expect(pendingItems(visibleRows(report, 'all'), [], 'models').map((i) => i.key)).toEqual(['model:b', 'model:c'])
    expect(pendingItems(visibleRows(report, 'audio'), []).map((i) => i.key)).toEqual(['model:c'])
  })

  it('skips what is already waiting or running', () => {
    const queue: UpdateItem[] = [{ key: 'engine:sdcpp', kind: 'engine', id: 'sdcpp', name: 'x', status: 'running', error: null }]
    expect(pendingItems(visibleRows(report, 'all'), queue, 'engines').map((i) => i.key)).toEqual(['engine:kiwi'])
  })
})

describe('engine items and the untested release', () => {
  const withLatest: EngineUpdate = { ...engine('sdcpp', 'current'), latest: { tag: 'master-999-zzz', regressions: [] } }

  it('asks for the tested release unless the user chose the latest one on that row', () => {
    expect(toEngineItem(withLatest).target).toBe('pinned')
    expect(toEngineItem(withLatest, 'latest').target).toBe('latest')
  })

  it('never puts a latest release in the bulk buttons, whatever the engine offers', () => {
    const rows = { engines: [{ ...withLatest, state: 'update' as const }, { ...engine('kiwi', 'update'), latest: { tag: 'x', regressions: [{ effect: 'e', source: 's' }] } }], models: [] }
    expect(pendingItems(rows, []).map((i) => i.target)).toEqual(['pinned', 'pinned'])
  })

  it('does not list a current engine that only has a latest or a rollback as something to update', () => {
    expect(pendingItems({ engines: [withLatest, { ...engine('audiocpp', 'current'), rollback: true }], models: [] }, [])).toEqual([])
  })
})

describe('outcomeOf', () => {
  it('follows a model download', () => {
    const download = (state: 'running' | 'done' | 'error' | 'cancelled', error: string | null = null): InstallContext => ({
      ...idle, downloads: { b: { model_id: 'b', state, done: 1, total: 2, rate: 0, eta: null, error } },
    })
    expect(outcomeOf({ kind: 'model', id: 'b' }, idle).phase).toBe('running') // no event yet
    expect(outcomeOf({ kind: 'model', id: 'b' }, download('running')).phase).toBe('running')
    expect(outcomeOf({ kind: 'model', id: 'b' }, download('done'))).toEqual({ phase: 'done', error: null })
    expect(outcomeOf({ kind: 'model', id: 'b' }, download('error', 'Espace disque insuffisant.'))).toEqual({ phase: 'error', error: 'Espace disque insuffisant.' })
    expect(outcomeOf({ kind: 'model', id: 'b' }, download('cancelled'), 'Annulé.')).toEqual({ phase: 'error', error: 'Annulé.' })
  })

  it('follows stable-diffusion.cpp through its own installer', () => {
    expect(outcomeOf({ kind: 'engine', id: 'sdcpp' }, { ...idle, engineInstall: { state: 'done' } }).phase).toBe('done')
    expect(outcomeOf({ kind: 'engine', id: 'sdcpp' }, { ...idle, engineInstall: { state: 'error', error: 'GPU' } })).toEqual({ phase: 'error', error: 'GPU' })
  })

  it('follows a pack only when the pack installer is about that pack', () => {
    const ctx = (pack: string, state: 'running' | 'done'): InstallContext => ({ ...idle, packInstall: { state, pack } })
    expect(outcomeOf({ kind: 'engine', id: 'kiwi' }, ctx('qwen3', 'done')).phase).toBe('running') // another pack's state
    expect(outcomeOf({ kind: 'engine', id: 'kiwi' }, ctx('kiwi', 'done')).phase).toBe('done')
    expect(outcomeOf({ kind: 'engine', id: 'audiocpp' }, ctx('audiocpp', 'running')).phase).toBe('running')
  })
})

describe('progressOf', () => {
  it('gives bytes for a model and for stable-diffusion.cpp, a message for a pack', () => {
    expect(progressOf({ kind: 'model', id: 'b' }, { ...idle, downloads: { b: { model_id: 'b', state: 'running', done: 5, total: 10, rate: 2, eta: 3, error: null } } })).toEqual({ done: 5, total: 10, rate: 2, eta: 3 })
    expect(progressOf({ kind: 'engine', id: 'sdcpp' }, { ...idle, engineInstall: { state: 'running', done: 4, total: 8, message: 'Téléchargement' } })).toEqual({ done: 4, total: 8, message: 'Téléchargement' })
    expect(progressOf({ kind: 'engine', id: 'kiwi' }, { ...idle, packInstall: { state: 'running', pack: 'kiwi', message: 'Installation', detail: 'torch' } })).toEqual({ done: 0, total: 0, message: 'Installation — torch' })
  })

  it('is null before the installer reports anything for that item', () => {
    expect(progressOf({ kind: 'model', id: 'b' }, idle)).toBeNull()
    expect(progressOf({ kind: 'engine', id: 'kiwi' }, idle)).toBeNull()
  })
})
