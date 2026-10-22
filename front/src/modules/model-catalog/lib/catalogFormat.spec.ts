/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../types'
import { alternativeToShow, backendLabel, formatSeconds, installedFirst, lacksDiskRoom, modelSize, noteIsWarning, pickerBackendKey, pickerModels, pickerSize, quantizeChoices, remainingGb, splitModels } from './catalogFormat'

const model = (over: Partial<ModelInfo>): ModelInfo =>
  ({ id: 'm', kind: 'image', audio: null, install: 'missing', installed_gb: 0, download_size_gb: 10, compatible: true, plan: { fits: true, strategy: 'full', note: '' }, backend: 'sdcpp', ...over }) as ModelInfo

describe('modelSize', () => {
  it('is null when the size is unknown', () => {
    expect(modelSize(null)).toBeNull()
    expect(modelSize(0)).toBeNull()
  })
  it('rounds megabytes to 10 below 1 GB and keeps gigabytes above', () => {
    expect(modelSize(0.654)).toEqual({ unit: 'mb', value: 650 })
    expect(modelSize(0.001)).toEqual({ unit: 'mb', value: 10 })
    expect(modelSize(4.5)).toEqual({ unit: 'gb', value: 4.5 })
  })
  it('picker size is rounded to hundreds of MB, then whole GB', () => {
    expect(pickerSize(0.65)).toEqual({ unit: 'mb', value: 700 })
    expect(pickerSize(4.6)).toEqual({ unit: 'gb', value: 5 })
  })
})

describe('ordering and filtering', () => {
  const list = [model({ id: 'a', install: 'missing' }), model({ id: 'b', install: 'installed' }), model({ id: 'c', install: 'partial' }), model({ id: 'd', install: 'installed' })]
  it('puts installed models first and keeps the catalogue order inside each group', () => {
    expect(installedFirst(list).map((m) => m.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('splits the transcription models of a kind from the generators', () => {
    const models = [
      model({ id: 'tts', kind: 'audio', audio: { task: 'tts' } as ModelInfo['audio'] }),
      model({ id: 'stt', kind: 'audio', audio: { task: 'stt' } as ModelInfo['audio'], install: 'installed' }),
      model({ id: 'img', kind: 'image' }),
    ]
    const { generators, speech } = splitModels(models, 'audio')
    expect(generators.map((m) => m.id)).toEqual(['tts'])
    expect(speech.map((m) => m.id)).toEqual(['stt'])
    expect(pickerModels(models, 'audio').models.map((m) => m.id)).toEqual(['tts'])
  })
  it('lists the most used models first, then the other installed ones, then the rest', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', install: 'installed' }), model({ id: 'c' }), model({ id: 'd', install: 'installed' }), model({ id: 'e', install: 'installed' })]
    expect(pickerModels(models, 'image').models.map((m) => m.id)).toEqual(['b', 'd', 'e', 'a', 'c'])
    expect(pickerModels(models, 'image', { usage: { e: 2, c: 5, ghost: 9 } }).models.map((m) => m.id)).toEqual(['c', 'e', 'b', 'd', 'a'])
  })
  it('hides the models too heavy for this machine unless asked, but never the selected one', () => {
    const heavy = { fits: false, strategy: 'none', note: '' } as ModelInfo['plan']
    const models = [model({ id: 'a' }), model({ id: 'big', plan: heavy }), model({ id: 'huge', plan: heavy })]
    expect(pickerModels(models, 'image')).toMatchObject({ hidden: 2 })
    expect(pickerModels(models, 'image').models.map((m) => m.id)).toEqual(['a'])
    expect(pickerModels(models, 'image', { keep: 'big' }).models.map((m) => m.id)).toEqual(['a', 'big'])
    expect(pickerModels(models, 'image', { keep: 'big' }).hidden).toBe(1)
    expect(pickerModels(models, 'image', { showUnfit: true }).models).toHaveLength(3)
  })
})

describe('disk room', () => {
  it('needs one GB of margin over what remains to download', () => {
    const m = model({ download_size_gb: 10, installed_gb: 4 })
    expect(remainingGb(m)).toBe(6)
    expect(lacksDiskRoom(m, 6.5, false)).toBe(true)
    expect(lacksDiskRoom(m, 7.5, false)).toBe(false)
  })
  it('never complains for an installed model, a running download or an unknown disk', () => {
    expect(lacksDiskRoom(model({ install: 'installed' }), 0, false)).toBe(false)
    expect(lacksDiskRoom(model({}), 0, true)).toBe(false)
    expect(lacksDiskRoom(model({}), undefined, false)).toBe(false)
  })
})

describe('backend labels', () => {
  it('names the device of a GGUF model, with GPU as fallback', () => {
    expect(backendLabel(model({ backend: 'sdcpp' }), { sdcppDevice: 'vulkan' })).toEqual({ key: 'models.backend.sdcpp', params: ['Vulkan'] })
    expect(backendLabel(model({ backend: 'sdcpp' }))).toEqual({ key: 'models.backend.sdcpp', params: ['GPU'] })
  })
  it('tells CUDA, ROCm and Metal PyTorch apart', () => {
    const torch = model({ backend: 'torch' })
    expect(backendLabel(torch, { torchDevice: 'cuda', accelerators: [{ backend: 'rocm' }] }).params).toEqual(['ROCm'])
    expect(backendLabel(torch, { torchDevice: 'cuda', accelerators: [{ backend: 'cuda' }] }).params).toEqual(['CUDA'])
    expect(backendLabel(torch, { torchDevice: 'mps' }).params).toEqual(['Metal'])
    expect(backendLabel(torch, { torchDevice: 'cpu' })).toEqual({ key: 'models.backend.torch' })
  })
  it('labels packs by kind and keeps the other backends by name', () => {
    expect(backendLabel(model({ backend: 'pack', kind: 'video' })).key).toBe('models.backend.video')
    expect(backendLabel(model({ backend: 'pack', kind: 'audio' })).key).toBe('models.backend.audio')
    expect(backendLabel(model({ backend: 'mlx' })).key).toBe('models.backend.mlx')
    expect(pickerBackendKey(model({ backend: 'pack', kind: 'video' }))).toBe('models.picker.backend.video')
    expect(pickerBackendKey(model({ backend: 'pack', kind: 'audio' }))).toBe('models.picker.backend.pack')
  })
})

describe('quantize choices and notes', () => {
  it('offers 4, 6 and 8 bits when the model has them, then bf16', () => {
    expect(quantizeChoices([4, 5, 8])).toEqual([4, 8, null])
    expect(quantizeChoices([])).toEqual([null])
  })
  it('a note is a warning when the model is incompatible or only runs on the CPU', () => {
    expect(noteIsWarning(model({}))).toBe(false)
    expect(noteIsWarning(model({ compatible: false }))).toBe(true)
    expect(noteIsWarning(model({ plan: { fits: true, strategy: 'full', note: 'x', degraded: true } }))).toBe(true)
  })
  it('names the GPU alternative of a slow model unless the note already does', () => {
    const slow = (note: string) => model({ plan: { fits: true, strategy: 'full', note, degraded: true, alternative: { id: 'g', name: 'Kokoro GGUF' } } })
    expect(alternativeToShow(slow('lent'))).toBe('Kokoro GGUF')
    expect(alternativeToShow(slow('Essayez Kokoro GGUF'))).toBeNull()
    expect(alternativeToShow(model({}))).toBeNull()
  })
})

describe('formatSeconds', () => {
  it('writes at most one decimal with the language separator', () => {
    expect(formatSeconds(5)).toBe('5 s')
    expect(formatSeconds(5.5, 'fr')).toBe('5,5 s')
    expect(formatSeconds(5.5, 'en')).toBe('5.5 s')
    expect(formatSeconds(5.04)).toBe('5 s')
  })
})
