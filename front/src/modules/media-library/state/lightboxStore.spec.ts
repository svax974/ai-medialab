/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { useLightboxStore } from './lightboxStore'

const asset = (id: string, favorite = false) => ({ id, favorite }) as Asset

describe('lightboxStore', () => {
  beforeEach(() => useLightboxStore.getState().close())

  it('opens on a valid position and ignores an empty list', () => {
    useLightboxStore.getState().show([], 0)
    expect(useLightboxStore.getState().open).toBe(false)
    useLightboxStore.getState().show([asset('a'), asset('b')], 9)
    expect(useLightboxStore.getState()).toMatchObject({ open: true, index: 1 })
  })

  it('moves within the list and patches an asset', () => {
    const { show, setIndex, patch } = useLightboxStore.getState()
    show([asset('a'), asset('b')], 0)
    setIndex(5)
    expect(useLightboxStore.getState().index).toBe(1)
    patch(asset('a', true))
    expect(useLightboxStore.getState().items[0].favorite).toBe(true)
  })

  it('drops an asset, keeps the position valid and closes when empty', () => {
    const { show, drop } = useLightboxStore.getState()
    show([asset('a'), asset('b')], 1)
    drop('b')
    expect(useLightboxStore.getState()).toMatchObject({ open: true, index: 0 })
    drop('a')
    expect(useLightboxStore.getState()).toMatchObject({ open: false, items: [] })
  })
})
