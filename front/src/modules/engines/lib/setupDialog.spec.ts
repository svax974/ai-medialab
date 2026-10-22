/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { InstallPlan, SetupRun } from '../types'
import { dialogPhase, formatSize, hasKnownTotal, IDLE_RUN, missingSteps, stepKindKey } from './setupDialog'

const step = (id: string, kind: 'base' | 'engine' | 'model', installed = false, size_mb = 100) => ({ id, kind, name: id, installed, size_mb, blocked: null })
const plan = (over: Partial<InstallPlan> = {}): InstallPlan => ({
  model_id: 'm', steps: [step('ffmpeg', 'base'), step('sdcpp', 'engine'), step('m', 'model')], ready: false, total_mb: 300, blocked: null, ...over,
})
const run = (over: Partial<SetupRun> = {}): SetupRun => ({ ...IDLE_RUN, model_id: 'm', state: 'running', ...over })

describe('dialogPhase', () => {
  it('loads until the plan is known', () => {
    expect(dialogPhase('m', undefined, IDLE_RUN)).toBe('loading')
  })

  it('asks for confirmation when something is missing', () => {
    expect(dialogPhase('m', plan(), IDLE_RUN)).toBe('confirm')
  })

  it('says it is ready when nothing is missing, and blocked with a reason', () => {
    expect(dialogPhase('m', plan({ ready: true, total_mb: 0 }), IDLE_RUN)).toBe('ready')
    expect(dialogPhase('m', plan({ blocked: 'Aucun GPU' }), IDLE_RUN)).toBe('blocked')
  })

  it('follows the run of this model', () => {
    expect(dialogPhase('m', plan(), run())).toBe('running')
    expect(dialogPhase('m', plan(), run({ state: 'done' }))).toBe('done')
    expect(dialogPhase('m', plan(), run({ state: 'error' }))).toBe('failed')
    expect(dialogPhase('m', plan(), run({ state: 'cancelled' }))).toBe('cancelled')
    expect(dialogPhase('m', undefined, run())).toBe('running')
  })

  it('ignores the run of another model', () => {
    expect(dialogPhase('m', plan(), run({ model_id: 'other' }))).toBe('confirm')
  })
})

describe('plan helpers', () => {
  it('keeps the missing steps in order', () => {
    const p = plan({ steps: [step('ffmpeg', 'base', true), step('sdcpp', 'engine'), step('m', 'model')] })
    expect(missingSteps(p).map((s) => s.id)).toEqual(['sdcpp', 'm'])
  })

  it('names the three levels', () => {
    expect(['base', 'engine', 'model'].map((k) => stepKindKey(k as 'base'))).toEqual(['engines.setup.kind.base', 'engines.setup.kind.engine', 'engines.setup.kind.model'])
  })

  it('knows when a bar has a length', () => {
    expect(hasKnownTotal({ total: 10 })).toBe(true)
    expect(hasKnownTotal({ total: 0 })).toBe(false)
  })
})

describe('formatSize', () => {
  it('uses Mo under a gibibyte and Go above, in the language of the user', () => {
    expect(formatSize(320, 'fr')).toBe('320 Mo')
    expect(formatSize(4608, 'fr')).toBe('4,5 Go')
    expect(formatSize(4608, 'en')).toBe('4.5 GB')
  })
})
