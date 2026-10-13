/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { ASSET_DRAG_TYPE, dragHasAsset, parseDraggedAsset } from './assetDrag'

describe('assetDrag', () => {
  it('recognizes a drag of one of our images among the drag types', () => {
    expect(dragHasAsset(['text/plain', ASSET_DRAG_TYPE])).toBe(true)
    expect(dragHasAsset(['Files'])).toBe(false)
    expect(dragHasAsset(undefined)).toBe(false)
  })

  it('parses a valid payload and refuses anything else', () => {
    expect(parseDraggedAsset('{"id":"a","url":"/media/outputs/a.png"}')).toMatchObject({ id: 'a' })
    expect(parseDraggedAsset('{"id":"a"}')).toBeNull()
    expect(parseDraggedAsset('null')).toBeNull()
    expect(parseDraggedAsset('not json')).toBeNull()
  })
})
