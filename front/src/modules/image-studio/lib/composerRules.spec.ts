/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { composerNotices, multiAlternative, placeholderKey, referenceRole, sendState } from './composerRules'

const model = (extra: Partial<ModelInfo> = {}): ModelInfo =>
  ({ id: 'a', name: 'Flux', reference_mode: 'none', max_references: 0, requires_references: false, compatible: true, ready: true, download_size_gb: 5, engine_reason: null, plan: { fits: true, strategy: 'full', note: '' }, ...extra }) as ModelInfo

describe('multiAlternative', () => {
  const list = [
    model({ id: 'a' }),
    model({ id: 'multi-big', reference_mode: 'multi', max_references: 4, ready: false, download_size_gb: 20 }),
    model({ id: 'multi-small', reference_mode: 'multi', max_references: 4, ready: false, download_size_gb: 8 }),
    model({ id: 'multi-ready', reference_mode: 'multi', max_references: 4, ready: true, download_size_gb: 30 }),
    model({ id: 'multi-few', reference_mode: 'multi', max_references: 1, ready: true }),
    model({ id: 'multi-heavy', reference_mode: 'multi', max_references: 4, compatible: false }),
  ]

  it('prefers a ready model, then the lightest download, and only one that takes all the images', () => {
    expect(multiAlternative(list, { id: 'a' }, 3)?.id).toBe('multi-ready')
    expect(multiAlternative(list.filter((m) => m.id !== 'multi-ready'), { id: 'a' }, 3)?.id).toBe('multi-small')
    expect(multiAlternative(list, { id: 'a' }, 1)?.id).toBe('multi-few')
  })

  it('never offers the current model or an incompatible one', () => {
    expect(multiAlternative(list, { id: 'multi-ready' }, 3)?.id).toBe('multi-small')
    expect(multiAlternative([list[5]], { id: 'a' }, 2)).toBeUndefined()
  })
})

describe('composerNotices', () => {
  it('asks for a reference when the model edits images', () => {
    expect(composerNotices(model({ requires_references: true, reference_mode: 'multi', max_references: 3 }), 0, false)).toEqual([{ id: 'requires', tone: 'warn', key: 'imageStudio.notice.requiresReferences', params: ['Flux'] }])
  })

  it('warns that references are ignored, offering the switch when there is one', () => {
    expect(composerNotices(model(), 1, true)).toEqual([{ id: 'none', tone: 'warn', key: 'imageStudio.notice.noReferences', params: ['Flux'], withSwitch: true }])
    expect(composerNotices(model(), 1, false)[0].withSwitch).toBe(false)
  })

  it('says an img2img model only uses the first image, and a multi model its maximum', () => {
    expect(composerNotices(model({ reference_mode: 'init', max_references: 1 }), 2, true)[0]).toMatchObject({ id: 'init', tone: 'warn', withSwitch: true })
    expect(composerNotices(model({ reference_mode: 'init', max_references: 1 }), 1, true)).toEqual([])
    expect(composerNotices(model({ reference_mode: 'multi', max_references: 2 }), 3, true)).toEqual([{ id: 'max', tone: 'info', key: 'imageStudio.notice.maxReferences', params: ['Flux', 2] }])
  })

  it('relays what the engine says when the machine cannot run the model, with a generic text as last resort', () => {
    expect(composerNotices(model({ compatible: false, engine_reason: 'Pas de GPU.' }), 0, false)).toEqual([{ id: 'incompatible', tone: 'warn', text: 'Pas de GPU.' }])
    expect(composerNotices(model({ compatible: false, plan: { fits: false, strategy: 'none', note: 'Trop lourd.' } }), 0, false)[0].text).toBe('Trop lourd.')
    expect(composerNotices(model({ compatible: false }), 0, false)).toEqual([{ id: 'incompatible', tone: 'warn', key: 'imageStudio.notice.cannotRun', params: ['Flux'] }])
  })

  it('shows the plan note only when the model does not run in full', () => {
    expect(composerNotices(model({ plan: { fits: true, strategy: 'model_offload', note: 'Décharge partielle.' } }), 0, false)).toEqual([{ id: 'plan', tone: 'info', text: 'Décharge partielle.' }])
    expect(composerNotices(model({ plan: { fits: true, strategy: 'full', note: 'Rien.' } }), 0, false)).toEqual([])
  })
})

describe('referenceRole', () => {
  it('marks every reference ignored when the model does not use them', () => {
    expect(referenceRole({ name: 'Flux', reference_mode: 'none', max_references: 0 }, 0)).toMatchObject({ noteKey: 'imageStudio.ref.note.ignored', ignored: true, helpParams: ['Flux'] })
  })

  it('makes the first reference the start image of an img2img model and ignores the others', () => {
    const init = { name: 'Flux', reference_mode: 'init' as const, max_references: 1 }
    expect(referenceRole(init, 0)).toMatchObject({ noteKey: 'imageStudio.ref.note.start', ignored: false })
    expect(referenceRole(init, 1)).toMatchObject({ noteKey: 'imageStudio.ref.note.ignored', helpKey: 'imageStudio.ref.help.initIgnored', ignored: true })
  })

  it('numbers the references of a multi-image model up to its maximum', () => {
    const multi = { name: 'Edit', reference_mode: 'multi' as const, max_references: 2 }
    expect(referenceRole(multi, 1)).toMatchObject({ noteKey: 'imageStudio.ref.note.image', noteParams: [2], helpParams: [2], ignored: false })
    expect(referenceRole(multi, 2)).toMatchObject({ helpKey: 'imageStudio.ref.help.multiIgnored', helpParams: [2], ignored: true })
  })
})

describe('face mode', () => {
  const face = model({ reference_mode: 'face', max_references: 2, requires_references: true })
  it('reads the first image as the face, the second as the start image, ignores the others', () => {
    expect(referenceRole(face, 0)).toMatchObject({ noteKey: 'imageStudio.ref.note.face', ignored: false })
    expect(referenceRole(face, 1)).toMatchObject({ noteKey: 'imageStudio.ref.note.start', helpKey: 'imageStudio.ref.help.faceStart', ignored: false })
    expect(referenceRole(face, 2)).toMatchObject({ noteKey: 'imageStudio.ref.note.ignored', ignored: true })
  })
  it('asks for the face first and warns past two images', () => {
    expect(placeholderKey(face, false)).toBe('imageStudio.placeholder.faceNeedsImage')
    expect(placeholderKey(face, true)).toBe('imageStudio.placeholder.face')
    expect(composerNotices(face, 3, false).map((n) => n.id)).toContain('max')
  })
})

describe('placeholderKey', () => {
  it('follows the references and the mode of the model', () => {
    expect(placeholderKey({ requires_references: false, reference_mode: 'none' }, false)).toBe('imageStudio.placeholder.default')
    expect(placeholderKey({ requires_references: true, reference_mode: 'multi' }, false)).toBe('imageStudio.placeholder.editNeedsImage')
    expect(placeholderKey({ requires_references: false, reference_mode: 'multi' }, true)).toBe('imageStudio.placeholder.multi')
    expect(placeholderKey({ requires_references: false, reference_mode: 'init' }, true)).toBe('imageStudio.placeholder.init')
    expect(placeholderKey({ requires_references: false, reference_mode: 'none' }, true)).toBe('imageStudio.placeholder.plain')
  })
})

describe('sendState', () => {
  const idle = { prompt: 'un chat', referenceCount: 0, uploading: 0, sending: false }

  it('allows a prompt on a ready model', () => {
    expect(sendState(model(), idle)).toEqual({ canSend: true, tipKey: 'imageStudio.send.tip.generate' })
  })

  it('blocks an empty prompt, an import in progress and a send in progress, without changing the tooltip', () => {
    expect(sendState(model(), { ...idle, prompt: '   ' }).canSend).toBe(false)
    expect(sendState(model(), { ...idle, uploading: 1 }).canSend).toBe(false)
    expect(sendState(model(), { ...idle, sending: true }).canSend).toBe(false)
    expect(sendState(model(), { ...idle, uploading: 1 }).tipKey).toBe('imageStudio.send.tip.generate')
  })

  it('explains why a model cannot be used: to install, incompatible, needs an image', () => {
    expect(sendState(model({ ready: false }), idle)).toEqual({ canSend: false, tipKey: 'imageStudio.send.tip.install' })
    expect(sendState(model({ ready: false, compatible: false }), idle).tipKey).toBe('imageStudio.send.tip.incompatible')
    expect(sendState(model({ requires_references: true }), idle)).toEqual({ canSend: false, tipKey: 'imageStudio.send.tip.needReference' })
    expect(sendState(model({ requires_references: true }), { ...idle, referenceCount: 1 }).canSend).toBe(true)
  })
})
