/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }))
const upload = vi.hoisted(() => vi.fn())
const focusTarget = vi.hoisted(() => vi.fn())
vi.mock('react-toastify', () => ({ toast }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({ i18n: { get: (key: string, params?: unknown[]) => (params ? `${key}:${params.join(',')}` : key) } }))
vi.mock('@/modules/studio-shell/lib/focusRegistry', () => ({ focusTarget }))
vi.mock('@/modules/studio-core/services/assetsApi', () => ({ assetsApi: { upload } }))

import { useImageDraftStore } from '@/modules/studio-core/state/imageDraftStore'
import { IMAGE_ACCEPT, uploadReferences } from './uploadReferences'

const file = (name: string, type: string) => new File(['x'], name, { type })
const created: string[] = []
const revoked: string[] = []

describe('uploadReferences', () => {
  beforeEach(() => {
    toast.warning.mockClear()
    toast.error.mockClear()
    focusTarget.mockClear()
    upload.mockReset()
    created.length = 0
    revoked.length = 0
    useImageDraftStore.setState({ references: [], uploading: [] })
    vi.stubGlobal('URL', { createObjectURL: (f: File) => (created.push(f.name), `blob:${f.name}`), revokeObjectURL: (u: string) => revoked.push(u) })
  })

  it('accepts the usual image types, by MIME type or extension', () => {
    expect(IMAGE_ACCEPT).toContain('image/png')
    expect(IMAGE_ACCEPT).toContain('.heic')
  })

  it('imports the images, adds the created assets as references and focuses the composer', async () => {
    upload.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    await uploadReferences([file('a.png', 'image/png'), file('b.jpg', '')])
    expect(upload).toHaveBeenCalledOnce()
    expect((upload.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(['a.png', 'b.jpg'])
    expect(useImageDraftStore.getState().references.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(useImageDraftStore.getState().uploading).toEqual([])
    expect(revoked).toEqual(['blob:a.png', 'blob:b.jpg'])
    expect(focusTarget).toHaveBeenCalledWith('composer')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('shows the previews while the server works', async () => {
    let release: (assets: unknown[]) => void = () => undefined
    upload.mockReturnValue(new Promise((resolve) => (release = resolve)))
    const running = uploadReferences([file('a.png', 'image/png')])
    expect(useImageDraftStore.getState().uploading.map((u) => u.previewUrl)).toEqual(['blob:a.png'])
    release([{ id: 'a1' }])
    await running
    expect(useImageDraftStore.getState().uploading).toEqual([])
  })

  it('ignores what is not an image, with a warning, and sends nothing when nothing is left', async () => {
    await uploadReferences([file('doc.pdf', 'application/pdf')])
    expect(toast.warning).toHaveBeenCalledWith('imageStudio.upload.ignored')
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps the images and warns when only some files are images', async () => {
    upload.mockResolvedValue([{ id: 'a1' }])
    await uploadReferences([file('a.png', 'image/png'), file('doc.pdf', 'application/pdf')])
    expect(toast.warning).toHaveBeenCalledOnce()
    expect((upload.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(['a.png'])
  })

  it('reports a failed import and cleans the previews', async () => {
    upload.mockRejectedValue(new Error('Image illisible : a.png'))
    await uploadReferences([file('a.png', 'image/png')])
    expect(toast.error).toHaveBeenCalledWith('imageStudio.upload.failed:Image illisible : a.png')
    expect(useImageDraftStore.getState().references).toEqual([])
    expect(useImageDraftStore.getState().uploading).toEqual([])
    expect(revoked).toEqual(['blob:a.png'])
  })
})
