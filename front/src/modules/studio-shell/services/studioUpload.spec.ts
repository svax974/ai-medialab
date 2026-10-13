/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Callback = (payload: unknown) => void
const upload = vi.hoisted(() => vi.fn())
vi.mock('@/modules_shared/common/core/http/HttpService', () => ({ httpService: { upload } }))
vi.mock('@/modules_shared/common/services/ConfigurationService', () => ({ configurationService: { getApiUrl: () => '/api/v1' } }))

import { StudioApiError, studioUpload } from './studioHttp'

/** A minimal `HttpResult`: callbacks registered by chaining, one of them fired right away. */
function result(outcome: { ok?: unknown; fail?: unknown }) {
  const chain = {
    then: (cb: Callback) => (outcome.ok !== undefined && cb(outcome.ok), chain),
    fail: (cb: Callback) => (outcome.fail !== undefined && cb(outcome.fail), chain),
    error: () => chain,
    notAuthorized: () => chain,
  }
  return chain
}

describe('studioUpload', () => {
  beforeEach(() => {
    upload.mockReset()
  })

  it('posts the form to the studio base (without /v1), in clear, and resolves the answer', async () => {
    upload.mockReturnValue(result({ ok: [{ id: 'a1' }] }))
    const form = new FormData()
    await expect(studioUpload('/assets', form)).resolves.toEqual([{ id: 'a1' }])
    expect(upload.mock.calls[0][0]).toBe('/api/assets')
    expect(upload.mock.calls[0][1]).toBe(form)
    expect(upload.mock.calls[0][2]).toMatchObject({ skipTransport: true })
  })

  it('reports the percent of the upload', async () => {
    upload.mockReturnValue(result({ ok: [] }))
    const onProgress = vi.fn()
    await studioUpload('/assets', new FormData(), { onProgress })
    const options = upload.mock.calls[0][2] as { onProgress: (progress: { loaded: number; total: number | null; percent: number | null }) => void }
    options.onProgress({ loaded: 5, total: 10, percent: 50 })
    options.onProgress({ loaded: 5, total: null, percent: null })
    expect(onProgress.mock.calls).toEqual([[50], [null]])
  })

  it('rejects with the status and the message of the server', async () => {
    upload.mockReturnValue(result({ fail: { statusCode: 422, message: 'Image illisible : a.png' } }))
    await expect(studioUpload('/assets', new FormData())).rejects.toMatchObject({ name: 'StudioApiError', status: 422, message: 'Image illisible : a.png' })
    upload.mockReturnValue(result({ fail: null }))
    await expect(studioUpload('/assets', new FormData())).rejects.toBeInstanceOf(StudioApiError)
  })
})
