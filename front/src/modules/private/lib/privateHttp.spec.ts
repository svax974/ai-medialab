/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { method: string; url: string }[] = []
const reply = (data: unknown) => {
  const chain: Record<string, unknown> = {}
  chain.then = (cb: (d: unknown) => void) => { cb(data); return chain }
  for (const name of ['fail', 'error', 'notAuthorized']) chain[name] = () => chain
  return chain
}

vi.mock('@/modules_shared/common/core/http/HttpService', () => ({
  httpService: {
    get: (url: string) => { calls.push({ method: 'get', url }); return reply({ ok: true }) },
    delete: (url: string) => { calls.push({ method: 'delete', url }); return reply({ ok: true }) },
    post: (url: string) => { calls.push({ method: 'post', url }); return reply({ ok: true }) },
    patch: (url: string) => { calls.push({ method: 'patch', url }); return reply({ ok: true }) },
    put: (url: string) => { calls.push({ method: 'put', url }); return reply({ ok: true }) },
    upload: (url: string) => { calls.push({ method: 'upload', url }); return reply([]) },
  },
}))
vi.mock('@/modules_shared/common/services/ConfigurationService', () => ({ configurationService: { getApiUrl: () => '/api/v1' } }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({ i18n: { get: (key: string) => key } }))

describe('the studio HTTP layer in a private session', () => {
  beforeEach(() => {
    calls.length = 0
  })

  async function load() {
    const http = await import('@/modules/studio-shell/services/studioHttp')
    const { usePrivateStore } = await import('../state/privateStore')
    usePrivateStore.getState().setActive(false)
    return { ...http, priv: usePrivateStore }
  }

  it('calls the normal routes in the normal mode', async () => {
    const { studioRequest } = await load()
    await studioRequest('get', '/conversations?mode=image')
    await studioRequest('post', '/messages', { prompt: 'p' })
    expect(calls.map((c) => c.url)).toEqual(['/api/conversations?mode=image', '/api/messages'])
  })

  it('calls the private twins while the session is on, and keeps the rest', async () => {
    const { studioRequest, studioUpload, priv } = await load()
    priv.getState().setActive(true)
    await studioRequest('get', '/conversations?mode=image')
    await studioRequest('post', '/messages', { prompt: 'p' })
    await studioRequest('post', '/messages/m1/retry', {})
    await studioRequest('get', '/queue')
    await studioRequest('get', '/models')
    await studioRequest('get', '/messages/model-usage')
    await studioUpload('/assets', new FormData())
    await studioUpload('/chat/attachments', new FormData())
    await studioRequest('post', '/chat/enhance-prompt', { kind: 'image', prompt: 'p' })
    await studioRequest('post', '/chat/model/unload')
    expect(calls.map((c) => c.url)).toEqual([
      '/api/private/conversations?mode=image', '/api/private/messages', '/api/private/messages/m1/retry', '/api/private/queue',
      '/api/models', '/api/messages/model-usage', '/api/private/assets',
      '/api/private/chat/attachments', '/api/private/chat/enhance-prompt', '/api/chat/model/unload',
    ])
  })

  it('refuses what would be kept and lists no gallery, without asking the server', async () => {
    const { studioRequest, priv } = await load()
    priv.getState().setActive(true)
    await expect(studioRequest('post', '/voices/from-asset', {})).rejects.toMatchObject({ status: 409, code: 'private' })
    await expect(studioRequest('post', '/chat/conversations/c/messages', {})).rejects.toMatchObject({ code: 'private' })
    await expect(studioRequest('get', '/assets?kind=generated&media=image')).resolves.toEqual({ items: [], next_before: null })
    expect(calls).toEqual([])
  })
})
