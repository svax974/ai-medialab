/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { setDropTarget, takeDropTarget } from './dropTarget'

describe('drop target', () => {
  it('remembers the slot dragged over until the drop reads it, once', () => {
    expect(takeDropTarget()).toBeUndefined()
    setDropTarget('end')
    expect(takeDropTarget()).toBe('end')
    expect(takeDropTarget()).toBeUndefined()
  })

  it('forgets the slot when the drag leaves it', () => {
    setDropTarget('start')
    setDropTarget(undefined)
    expect(takeDropTarget()).toBeUndefined()
  })
})
