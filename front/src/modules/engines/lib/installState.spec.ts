/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { engineDot, engineRows, nextSetupStep, packDot, packRows, parseInstallState, relevantInstall, selectInstall, setupPlan } from './installState'

describe('selectInstall', () => {
  it('uses the live state once something happened, else the one read with the system', () => {
    expect(selectInstall({ state: 'running' as const }, { state: 'done' }).state).toBe('running')
    expect(selectInstall({ state: 'idle' as const }, { state: 'error' }).state).toBe('error')
    expect(selectInstall({ state: 'idle' as const }, undefined).state).toBe('idle')
  })
  it('parses an event payload and rejects a malformed one', () => {
    expect(parseInstallState({ state: 'running', pack: 'p' })).toEqual({ state: 'running', pack: 'p' })
    expect(parseInstallState({ pack: 'p' })).toBeNull()
    expect(parseInstallState(undefined)).toBeNull()
  })
})

describe('engineRows', () => {
  it('lists GGUF, MLX and PyTorch in that order, skipping what the engine did not report', () => {
    const rows = engineRows({ torch: { available: true, variant: 'cuda' }, sdcpp: { available: true, variant: 'vulkan' } })
    expect(rows.map((r) => r.id)).toEqual(['sdcpp', 'torch'])
    expect(rows[0]).toMatchObject({ available: true, installable: false, variant: 'vulkan' })
  })
  it('flags only the missing stable-diffusion.cpp as installable', () => {
    const rows = engineRows({ sdcpp: { available: false, installable: true, install_size_mb: 120 }, torch: { available: false, installable: true, reason: 'GPU absent' } })
    expect(rows.find((r) => r.id === 'sdcpp')).toMatchObject({ installable: true, installSizeMb: 120 })
    expect(rows.find((r) => r.id === 'torch')?.installable).toBe(false)
  })
  it('hides the engines that cannot exist on this machine (Mac only)', () => {
    const rows = engineRows({ sdcpp: { available: true }, mlx: { available: false, reason: 'Réservé aux Mac Apple Silicon' } })
    expect(rows.map((r) => r.id)).toEqual(['sdcpp'])
  })
  it('colours the dot: available, installable, unavailable', () => {
    expect(engineDot({ available: true, installable: false })).toBe('ok')
    expect(engineDot({ available: false, installable: true })).toBe('warn')
    expect(engineDot({ available: false, installable: false })).toBe('faint')
    expect(packDot({ installed: false, installable: true })).toBe('warn')
  })
})

describe('packRows', () => {
  const packs = { tts: { name: 'TTS', size_mb: 900, installed: true }, ltx: { name: 'LTX', size_mb: 5000, installed: false, installable: true }, free: { name: 'Free', size_mb: 1, installed: false, reason: 'x' } }
  const models = [
    { kind: 'audio', engine_pack: 'tts' },
    { kind: 'video', engine_pack: 'ltx' },
  ] as Pick<ModelInfo, 'kind' | 'engine_pack'>[]
  it('gives a video tab the packs its models use', () => {
    expect(packRows(packs, models, 'video').map((r) => r.id)).toEqual(['ltx'])
  })
  it('gives the audio tab its packs and the packs no video model uses', () => {
    expect(packRows(packs, models, 'audio').map((r) => r.id)).toEqual(['tts', 'free'])
  })
  it('maps the pack fields', () => {
    expect(packRows(packs, models, 'video')[0]).toEqual({ id: 'ltx', name: 'LTX', sizeMb: 5000, installed: false, installable: true, reason: undefined })
    expect(packRows(undefined, models, 'audio')).toEqual([])
  })
})

describe('setupPlan', () => {
  const model = (over: Partial<ModelInfo>) => ({ needs_engine_install: false, install: 'installed', engine_install_size_mb: 120, download_size_gb: 5, installed_gb: 1, ...over }) as ModelInfo
  it('is null when nothing is missing', () => {
    expect(setupPlan(model({}))).toBeNull()
  })
  it('lists the engine and the remaining model download', () => {
    expect(setupPlan(model({ needs_engine_install: true, install: 'partial' }))).toEqual({ needEngine: true, needModel: true, engineMb: 120, modelGb: 4 })
    expect(setupPlan(model({ install: 'missing', installed_gb: 0 }))).toMatchObject({ needEngine: false, needModel: true, modelGb: 5 })
  })
})

describe('relevantInstall and nextSetupStep', () => {
  it('follows the pack installer while it works or when it is the only one that did', () => {
    const sd = { state: 'done' as const }
    expect(relevantInstall(sd, { state: 'running' })).toEqual({ state: 'running' })
    expect(relevantInstall({ state: 'idle' }, { state: 'done' })).toEqual({ state: 'done' })
    expect(relevantInstall(sd, { state: 'idle' })).toBe(sd)
  })
  it('waits while installing, gives up on error or cancel, downloads once done', () => {
    expect(nextSetupStep(null, 'done')).toBe('wait')
    expect(nextSetupStep('m', 'idle')).toBe('wait')
    expect(nextSetupStep('m', 'running')).toBe('wait')
    expect(nextSetupStep('m', 'error')).toBe('abort')
    expect(nextSetupStep('m', 'cancelled')).toBe('abort')
    expect(nextSetupStep('m', 'done')).toBe('download')
  })
})
