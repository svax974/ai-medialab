/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { countText, emptyKey, galleryState, GALLERY_COLUMNS, nextCursor } from './gallery'

describe('nextCursor', () => {
  it('follows next_before and stops at null', () => {
    expect(nextCursor({ next_before: 12.5 })).toBe(12.5)
    expect(nextCursor({ next_before: null })).toBeUndefined()
  })
})

describe('countText', () => {
  it('adds a plus while more pages exist', () => {
    expect(countText(60, true)).toBe('60+')
    expect(countText(7, false)).toBe('7')
  })
})

describe('galleryState', () => {
  it('shows the grid as soon as there are items, even while refreshing or after an error', () => {
    expect(galleryState({ isLoading: true, isError: false, itemCount: 3 })).toBe('ready')
    expect(galleryState({ isLoading: false, isError: true, itemCount: 3 })).toBe('ready')
  })

  it('tells loading, error and empty apart', () => {
    expect(galleryState({ isLoading: true, isError: false, itemCount: 0 })).toBe('loading')
    expect(galleryState({ isLoading: false, isError: true, itemCount: 0 })).toBe('error')
    expect(galleryState({ isLoading: false, isError: false, itemCount: 0 })).toBe('empty')
  })
})

describe('emptyKey', () => {
  it('prefers the favorites message, then the search one, then the plain one (same order as before)', () => {
    expect(emptyKey('image', true, 'cat')).toBe('library.image.emptyFavorites')
    expect(emptyKey('video', false, 'cat')).toBe('library.emptySearch')
    expect(emptyKey('audio', false, '')).toBe('library.audio.empty')
  })
})

describe('GALLERY_COLUMNS', () => {
  it('keeps the column counts of the former galleries', () => {
    expect(GALLERY_COLUMNS.image).toEqual({ xs: 2, sm: 2, md: 3, lg: 4, xl: 5 })
    expect(GALLERY_COLUMNS.video.xs).toBe(1)
  })
})
