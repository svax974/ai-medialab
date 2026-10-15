/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SENTINEL = 'SENTINELLE-prompt-privé-7f3a91'

/** A `localStorage` that remembers every write, so that a leak cannot hide in a key that was written then removed. */
function memoryStorage() {
  const data = new Map<string, string>()
  const writes: string[] = []
  return {
    data,
    writes,
    api: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); writes.push(`${k}=${v}`) },
      removeItem: (k: string) => { data.delete(k) },
    },
  }
}

describe('the stores that keep what the user typed, around a private session', () => {
  let mem: ReturnType<typeof memoryStorage>

  async function load() {
    vi.resetModules()
    mem = memoryStorage()
    mem.data.set('cn-composer', JSON.stringify({ state: { prompt: 'mon brouillon normal', paramsByModel: {}, count: 2, referenceSize: null }, version: 0 }))
    vi.stubGlobal('localStorage', mem.api)
    const image = await import('@/modules/studio-core/state/imageDraftStore')
    const video = await import('@/modules/video-studio/state/videoDraftStore')
    const audio = await import('@/modules/audio-studio/state/audioDraftStore')
    const priv = await import('../state/privateStore')
    const storage = await import('./privacyStorage')
    return { image: image.useImageDraftStore, video: video.useVideoDraftStore, audio: audio.useAudioDraftStore, priv: priv.usePrivateStore, storage }
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  /** What the app does on entering (flag first, then the composers are emptied) and on leaving (emptied, flag off, read back). */
  const enter = (s: Awaited<ReturnType<typeof load>>) => { s.priv.getState().setActive(true); s.storage.emptyContentStores() }
  const leave = async (s: Awaited<ReturnType<typeof load>>) => { s.storage.emptyContentStores(); s.priv.getState().setActive(false); await s.storage.restoreContentStores() }

  it('starts normally: the draft of the normal mode is read', async () => {
    const s = await load()
    expect(s.image.getState().prompt).toBe('mon brouillon normal')
  })

  it('a private session starts with empty composers and writes nothing, whatever the user types', async () => {
    const s = await load()
    const writesBefore = mem.writes.length
    enter(s)
    expect(s.image.getState().prompt).toBe('')
    s.image.getState().setPrompt(SENTINEL)
    s.image.getState().setParams('demo', { negative_prompt: SENTINEL })
    s.video.getState().setPrompt(SENTINEL)
    s.audio.getState().setPrompt(SENTINEL)
    expect(s.image.getState().prompt).toBe(SENTINEL) // it works in memory
    expect(mem.writes.slice(writesBefore).join('')).not.toContain(SENTINEL)
    expect([...mem.data.values()].join('')).not.toContain(SENTINEL)
  })

  it('leaving gives back the normal drafts, untouched and still on disk, with nothing of the session in them', async () => {
    const s = await load()
    enter(s)
    s.image.getState().setPrompt(SENTINEL)
    await leave(s)
    expect(s.image.getState().prompt).toBe('mon brouillon normal')
    expect(s.image.getState().count).toBe(2)
    expect(JSON.parse(mem.data.get('cn-composer') as string).state.prompt).toBe('mon brouillon normal')
    s.image.getState().setPrompt('nouveau brouillon') // normal again: remembered again
    expect(JSON.parse(mem.data.get('cn-composer') as string).state.prompt).toBe('nouveau brouillon')
    expect(mem.writes.join('')).not.toContain(SENTINEL)
  })

  it('a blocked or full storage never breaks the stores', async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('blocked') } })
    const { useImageDraftStore } = await import('@/modules/studio-core/state/imageDraftStore')
    expect(() => useImageDraftStore.getState().setPrompt('x')).not.toThrow()
    expect(useImageDraftStore.getState().prompt).toBe('x')
  })
})
