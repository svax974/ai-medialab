/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, vi } from 'vitest'
import { pauseOthers } from './playback'

const player = () => ({ pause: vi.fn() }) as unknown as HTMLVideoElement

describe('pauseOthers', () => {
  it('pauses every video of the page but the one that starts', () => {
    const [a, b, c] = [player(), player(), player()]
    pauseOthers(b, { querySelectorAll: () => [a, b, c] } as unknown as Pick<Document, 'querySelectorAll'>)
    expect(a.pause).toHaveBeenCalledTimes(1)
    expect(c.pause).toHaveBeenCalledTimes(1)
    expect(b.pause).not.toHaveBeenCalled()
  })
})
