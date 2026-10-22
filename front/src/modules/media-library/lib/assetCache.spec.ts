/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset, AssetPage } from '../types'
import { flattenPages, patchAssetInData, removeAssetFromData } from './assetCache'

const asset = (id: string, extra: Partial<Asset> = {}) => ({ id, favorite: false, ...extra }) as Asset
const page = (...ids: string[]): AssetPage => ({ items: ids.map((id) => asset(id)), next_before: null })
const infinite = (...pages: AssetPage[]) => ({ pages, pageParams: pages.map(() => null) })

describe('patchAssetInData', () => {
  it('patches one page (recent images)', () => {
    const next = patchAssetInData(page('a', 'b'), asset('b', { favorite: true })) as AssetPage
    expect(next.items.map((a) => a.favorite)).toEqual([false, true])
  })

  it('patches the page of an infinite list that holds the asset and keeps the others', () => {
    const data = infinite(page('a'), page('b'))
    const next = patchAssetInData(data, asset('b', { favorite: true })) as ReturnType<typeof infinite>
    expect(next.pages[0]).toBe(data.pages[0])
    expect(next.pages[1].items[0].favorite).toBe(true)
  })

  it('returns the same pages when the asset is not listed', () => {
    const data = page('a')
    expect(patchAssetInData(data, asset('z'))).toEqual(data)
  })
})

describe('removeAssetFromData', () => {
  it('removes an asset from a page and from an infinite list', () => {
    expect((removeAssetFromData(page('a', 'b'), 'a') as AssetPage).items.map((a) => a.id)).toEqual(['b'])
    const next = removeAssetFromData(infinite(page('a', 'b'), page('c')), 'c') as ReturnType<typeof infinite>
    expect(next.pages.map((p) => p.items.map((a) => a.id))).toEqual([['a', 'b'], []])
  })
})

describe('flattenPages', () => {
  it('lists the pages in order without duplicates', () => {
    expect(flattenPages(infinite(page('a', 'b'), page('b', 'c'))).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('is empty before the first answer', () => {
    expect(flattenPages(undefined)).toEqual([])
  })
})
