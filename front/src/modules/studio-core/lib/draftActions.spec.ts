/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const focusTarget = vi.hoisted(() => vi.fn())
vi.mock('react-toastify', () => ({ toast }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({ i18n: { get: (key: string) => key } }))
vi.mock('@/modules/studio-shell/lib/focusRegistry', () => ({ focusTarget }))

import type { Asset } from '../types'
import { useModelSelectionStore } from '@/modules/model-catalog/state/modelSelectionStore'
import { useImageDraftStore } from '../state/imageDraftStore'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { addAsReference, reuseGenerationSettings, reuseUserMessage } from './draftActions'

const asset = (id: string) => ({ id }) as Asset

describe('draftActions', () => {
  beforeEach(() => {
    toast.success.mockClear()
    focusTarget.mockClear()
    useImageDraftStore.setState({ prompt: '', references: [], uploading: [], paramsByModel: {}, count: 1, seed: null })
    useLightboxStore.getState().close()
  })

  it('adds an image as a reference, closes the viewer and focuses the composer', () => {
    useLightboxStore.getState().show([asset('a')], 0)
    addAsReference(asset('a'))
    expect(useImageDraftStore.getState().references.map((r) => r.id)).toEqual(['a'])
    expect(useLightboxStore.getState().open).toBe(false)
    expect(focusTarget).toHaveBeenCalledWith('composer')
    expect(toast.success).toHaveBeenCalledWith('thread.reference.added', { autoClose: 1800 })
  })

  it('replaces the draft with the prompt and the references of a user message, selecting the text', () => {
    useImageDraftStore.setState({ prompt: 'old', references: [asset('x')] })
    reuseUserMessage({ prompt: 'new', references: [asset('r1'), asset('r2')] })
    expect(useImageDraftStore.getState().prompt).toBe('new')
    expect(useImageDraftStore.getState().references.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(focusTarget).toHaveBeenCalledWith('composer', true)
  })

  it('restores the model, the parameters, the count and the first seed of a generation', () => {
    const done = reuseGenerationSettings({ model_id: 'flux', params: { aspect: '4:5', steps: 8, count: 3, seeds: [5, 6, 7], width: 832, height: 1040 } })
    expect(done).toBe(true)
    expect(useModelSelectionStore.getState().selected.image).toBe('flux')
    expect(useImageDraftStore.getState()).toMatchObject({ paramsByModel: { flux: { aspect: '4:5', steps: 8 } }, count: 3, seed: 5 })
    expect(toast.success).toHaveBeenCalledWith('thread.settings.reused', { autoClose: 1800 })
  })

  it('does nothing for a generation without a model', () => {
    expect(reuseGenerationSettings({ model_id: null, params: {} })).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })
})
