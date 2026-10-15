/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { DownloadProgress, ModelInfo } from '@/modules/model-catalog'
import { ADVISOR_MODEL_ID, DISK_MARGIN_GB, deriveLocalAi, pickAdvisor, type LocalAiInput } from './localAi'

const llm = (id: string, over: Partial<ModelInfo> = {}): ModelInfo =>
  ({ id, kind: 'llm', name: id.toUpperCase(), install: 'missing', installed_gb: 0, download_size_gb: 2.33, needs_engine_install: true, engine_install_size_mb: 11, download: null, ...over }) as ModelInfo

const input = (over: Partial<LocalAiInput> = {}): LocalAiInput => ({
  models: [llm(ADVISOR_MODEL_ID), llm('llm-qwen3-8b', { download_size_gb: 4.68 })],
  engineInstalled: false, engineSizeMb: 11, engineInstall: { state: 'idle' }, downloads: {}, pendingModelId: null, freeDiskGb: 100, ...over,
})

const running = (id: string, done: number, total: number): DownloadProgress => ({ model_id: id, state: 'running', done, total, rate: 5e6, eta: 30, error: null })

describe('pickAdvisor', () => {
  const models = [llm('a'), llm(ADVISOR_MODEL_ID), llm('b'), { ...llm('x'), kind: 'image' } as ModelInfo]
  it('takes the catalogue recommendation, else the known adviser, else the first chat model', () => {
    expect(pickAdvisor(models, 'b')?.id).toBe('b')
    expect(pickAdvisor(models, 'missing')?.id).toBe(ADVISOR_MODEL_ID)
    expect(pickAdvisor([llm('a'), llm('b')])?.id).toBe('a')
    expect(pickAdvisor([{ ...llm('x'), kind: 'image' } as ModelInfo])).toBeNull()
  })
})

describe('deriveLocalAi', () => {
  it('is unknown until the catalogue is read', () => {
    expect(deriveLocalAi(input({ models: undefined })).state).toBe('unknown')
  })

  it('needs the engine and the model: sizes, disk needed, nothing started', () => {
    const v = deriveLocalAi(input())
    expect(v).toMatchObject({ state: 'needs-setup', modelId: ADVISOR_MODEL_ID, engineInstalled: false, modelInstalled: false, engineSizeMb: 11, modelSizeGb: 2.33, freeGb: 100, progress: null, error: null })
    expect(v.neededGb).toBeCloseTo(2.33 + 11 / 1024, 3)
  })

  it('only needs the model when the engine is there, and the remaining bytes of a partial download', () => {
    const v = deriveLocalAi(input({ engineInstalled: true, models: [llm(ADVISOR_MODEL_ID, { install: 'partial', installed_gb: 1, needs_engine_install: false })] }))
    expect(v).toMatchObject({ state: 'needs-setup', engineSizeMb: 0 })
    expect(v.modelSizeGb).toBeCloseTo(1.33, 2)
  })

  it('is ready when the engine and any chat model are installed (not only the recommended one)', () => {
    const v = deriveLocalAi(input({ engineInstalled: true, models: [llm(ADVISOR_MODEL_ID), llm('llm-qwen3-8b', { install: 'installed' })] }))
    expect(v).toMatchObject({ state: 'ready', modelInstalled: true, modelSizeGb: 0, engineSizeMb: 0, neededGb: 0 })
  })

  it('refuses to start without room for the engine, the model and the margin', () => {
    expect(deriveLocalAi(input({ freeDiskGb: 2.3 })).state).toBe('no-space')
    const need = 2.33 + 11 / 1024 + DISK_MARGIN_GB
    expect(deriveLocalAi(input({ freeDiskGb: need - 0.01 })).state).toBe('no-space')
    expect(deriveLocalAi(input({ freeDiskGb: need + 0.01 })).state).toBe('needs-setup')
    expect(deriveLocalAi(input({ freeDiskGb: null })).state).toBe('needs-setup') // unknown disk: not a reason to refuse
  })

  it('follows the engine install, then the model download', () => {
    const engine = deriveLocalAi(input({ engineInstall: { state: 'running', done: 5, total: 11, message: 'Téléchargement du moteur (metal)' } }))
    expect(engine).toMatchObject({ state: 'installing', progress: { step: 'engine', done: 5, total: 11, message: 'Téléchargement du moteur (metal)' } })
    const between = deriveLocalAi(input({ engineInstall: { state: 'done' }, engineInstalled: true, pendingModelId: ADVISOR_MODEL_ID }))
    expect(between.state).toBe('downloading')
    const model = deriveLocalAi(input({ engineInstalled: true, downloads: { [ADVISOR_MODEL_ID]: running(ADVISOR_MODEL_ID, 100, 2000) } }))
    expect(model).toMatchObject({ state: 'downloading', progress: { step: 'model', done: 100, total: 2000, rate: 5e6, eta: 30 } })
  })

  it('reads a download that the catalogue reports as running (after a reload)', () => {
    const v = deriveLocalAi(input({ engineInstalled: true, models: [llm(ADVISOR_MODEL_ID, { download: running(ADVISOR_MODEL_ID, 1, 2) })] }))
    expect(v).toMatchObject({ state: 'downloading', progress: { step: 'model', done: 1, total: 2 } })
  })

  it('reports the error of the engine install or of the download, and lets it be retried', () => {
    expect(deriveLocalAi(input({ engineInstall: { state: 'error', error: 'Archive corrompue' } }))).toMatchObject({ state: 'error', error: 'Archive corrompue' })
    const failed: DownloadProgress = { model_id: ADVISOR_MODEL_ID, state: 'error', done: 0, total: 0, rate: 0, eta: null, error: 'Disque plein' }
    expect(deriveLocalAi(input({ engineInstalled: true, downloads: { [ADVISOR_MODEL_ID]: failed } }))).toMatchObject({ state: 'error', error: 'Disque plein' })
  })

  it('a finished install with everything in place is ready, whatever an old error said', () => {
    const v = deriveLocalAi(input({ engineInstalled: true, models: [llm(ADVISOR_MODEL_ID, { install: 'installed' })], engineInstall: { state: 'done' } }))
    expect(v.state).toBe('ready')
  })

  it('falls back on the model entry when the machine does not say whether the engine is installed', () => {
    expect(deriveLocalAi(input({ engineInstalled: undefined, models: [llm(ADVISOR_MODEL_ID, { needs_engine_install: false })] })).engineInstalled).toBe(true)
    expect(deriveLocalAi(input({ engineInstalled: undefined })).engineInstalled).toBe(false)
  })
})
