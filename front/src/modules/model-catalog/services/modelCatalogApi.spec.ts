/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest }))

import { modelCatalogApi } from './modelCatalogApi'

describe('modelCatalogApi', () => {
  beforeEach(() => studioRequest.mockClear())

  it('reads the catalogue', async () => {
    await modelCatalogApi.catalog()
    expect(studioRequest).toHaveBeenCalledWith('get', '/models')
  })
  it('starts, cancels and deletes with the model id encoded', async () => {
    await modelCatalogApi.download('a b')
    await modelCatalogApi.cancelDownload('a b')
    await modelCatalogApi.deleteModel('a b')
    await modelCatalogApi.freeBf16Source('a b')
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/models/a%20b/download'],
      ['delete', '/models/a%20b/download'],
      ['delete', '/models/a%20b'],
      ['delete', '/models/a%20b/source/bf16'],
    ])
  })
  it('adds and removes a custom model', async () => {
    await modelCatalogApi.addCustom('org/name', 'Q4_K')
    await modelCatalogApi.removeCustom('custom-1')
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/models/custom', { repo: 'org/name', option: 'Q4_K' }],
      ['delete', '/models/custom-1/custom'],
    ])
  })
  it('searches with the kind and the encoded query and returns the results', async () => {
    studioRequest.mockResolvedValueOnce({ results: [{ repo: 'a/b' }] })
    expect(await modelCatalogApi.hubSearch('video', 'wan 2.1')).toEqual([{ repo: 'a/b' }])
    expect(studioRequest).toHaveBeenCalledWith('get', '/hf/search?kind=video&q=wan%202.1')
  })
  it('asks what is new with the kind, the window and the flags', async () => {
    await modelCatalogApi.hubTrending('llm', { days: 30 })
    await modelCatalogApi.hubTrending('image', { days: 90, includeHeavy: true, refresh: true })
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/hf/trending?kind=llm&days=30&include_heavy=false&refresh=false'],
      ['get', '/hf/trending?kind=image&days=90&include_heavy=true&refresh=true'],
    ])
  })
  it('inspects a repository with the encoded name', async () => {
    await modelCatalogApi.hubInspect('org/name')
    expect(studioRequest).toHaveBeenCalledWith('get', '/hf/inspect?repo=org%2Fname')
  })
})
