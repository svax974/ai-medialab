/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SENTINEL = 'SENTINELLE-prompt-privé-7f3a91'
const INFO = { active: true, created_at: 1, last_activity: 1, expires_at: 1801, conversations: 0, results: 0 }
const api = { start: vi.fn(), end: vi.fn(), info: vi.fn(), leaveBeacon: vi.fn() }
vi.mock('../services/privateApi', () => ({ privateApi: api }))

describe('entering and leaving the private mode', () => {
  const data = new Map<string, string>()
  const writes: string[] = []

  async function load() {
    vi.resetModules()
    data.clear()
    writes.length = 0
    data.set('cn-composer', JSON.stringify({ state: { prompt: 'brouillon normal', paramsByModel: {}, count: 1, referenceSize: null }, version: 0 }))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); writes.push(v) },
      removeItem: (k: string) => { data.delete(k) },
    })
    const { QueryClient } = await import('@tanstack/react-query')
    const image = (await import('@/modules/studio-core/state/imageDraftStore')).useImageDraftStore
    const keys = (await import('@/modules/studio-shell/lib/queryKeys')).studioKeys
    const session = await import('./privateSession')
    const store = (await import('../state/privateStore')).usePrivateStore
    return { client: new QueryClient(), image, keys, session, store }
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
    api.start.mockReset().mockResolvedValue(INFO)
    api.end.mockReset().mockResolvedValue({ ...INFO, active: false })
  })

  it('enters with empty composers and an empty cache of the normal side, and nothing typed there is stored', async () => {
    const { client, image, keys, session, store } = await load()
    client.setQueryData(keys.conversation('c1'), { id: 'c1', title: 'une conversation normale' })
    expect(await session.enterPrivate(client)).toBe(true)
    expect(store.getState()).toMatchObject({ active: true, busy: false, info: INFO })
    expect(image.getState().prompt).toBe('')
    expect(client.getQueryData(keys.conversation('c1'))).toBeUndefined()
    image.getState().setPrompt(SENTINEL)
    expect(writes.join('')).not.toContain(SENTINEL)
  })

  it('falls back to the normal side, drafts intact, when the server cannot start a session', async () => {
    const { client, image, session, store } = await load()
    api.start.mockRejectedValue(new Error('down'))
    expect(await session.enterPrivate(client)).toBe(false)
    expect(store.getState()).toMatchObject({ active: false, busy: false, info: null })
    expect(image.getState().prompt).toBe('brouillon normal')
    expect(JSON.parse(data.get('cn-composer') as string).state.prompt).toBe('brouillon normal')
  })

  it('leaves: the server erases, the normal drafts come back, nothing private remains in the cache', async () => {
    const { client, image, keys, session, store } = await load()
    await session.enterPrivate(client)
    image.getState().setPrompt(SENTINEL)
    client.setQueryData(keys.conversation('p1'), { id: 'p1', title: SENTINEL })
    await session.leavePrivate(client)
    expect(api.end).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ active: false, info: null })
    expect(image.getState().prompt).toBe('brouillon normal')
    expect(client.getQueryData(keys.conversation('p1'))).toBeUndefined()
    expect(writes.join('')).not.toContain(SENTINEL)
  })

  it('leaves even when the server is unreachable (it erases at its next start)', async () => {
    const { client, session, store } = await load()
    await session.enterPrivate(client)
    api.end.mockRejectedValue(new Error('down'))
    await session.leavePrivate(client)
    expect(store.getState().active).toBe(false)
  })

  it('"erase now" ends the session and starts an empty one, the mode stays on', async () => {
    const { client, image, session, store } = await load()
    await session.enterPrivate(client)
    image.getState().setPrompt(SENTINEL)
    api.start.mockClear()
    await session.eraseNow(client)
    expect(api.end).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(store.getState().active).toBe(true)
    expect(image.getState().prompt).toBe('')
  })

  it('entering twice or while busy does nothing more', async () => {
    const { client, session } = await load()
    await session.enterPrivate(client)
    api.start.mockClear()
    expect(await session.enterPrivate(client)).toBe(true)
    expect(api.start).not.toHaveBeenCalled()
  })
})
