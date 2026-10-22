/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { setupButtonKey, setupParts } from './setupLabels'

const gb = (n: number) => n.toFixed(1)

describe('setupParts', () => {
  it('describes the engine (with its name when known) and the model', () => {
    expect(setupParts({ needEngine: true, needModel: true, engineMb: 119.6, modelGb: 4.5 }, 'GGUF', gb)).toEqual([
      { key: 'engines.setup.engineNamed', params: ['GGUF', '120'] },
      { key: 'engines.setup.model', params: ['4.5'] },
    ])
    expect(setupParts({ needEngine: true, needModel: false, engineMb: 50, modelGb: 0 }, null, gb)).toEqual([{ key: 'engines.setup.engine', params: ['50'] }])
  })
  it('names only the model when the engine is there', () => {
    expect(setupParts({ needEngine: false, needModel: true, engineMb: 0, modelGb: 2 }, 'x', gb)).toEqual([{ key: 'engines.setup.model', params: ['2.0'] }])
  })
  it('labels the button after what it installs', () => {
    expect(setupButtonKey({ needEngine: true, needModel: true, engineMb: 0, modelGb: 0 })).toBe('engines.setup.all')
    expect(setupButtonKey({ needEngine: true, needModel: false, engineMb: 0, modelGb: 0 })).toBe('engines.setup.engineOnly')
    expect(setupButtonKey({ needEngine: false, needModel: true, engineMb: 0, modelGb: 0 })).toBe('engines.setup.modelOnly')
  })
})
