/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { HubOption } from '../types'
import { chosenOption, compactCount, defaultOption, isAddBlocked, optionDoesNotFit, optionDownloadGb, sharedDownloadGb } from './hubSearch'

const opt = (label: string, fits?: boolean): HubOption => ({ key: label, label, precision: label, size_gb: 1, fits })

describe('compactCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(compactCount(12_400)).toBe('12 k')
    expect(compactCount(1_250_000, 'en')).toBe('1.3 M')
    expect(compactCount(1_250_000, 'fr')).toBe('1,3 M')
    expect(compactCount(999)).toBe('999')
  })
})

describe('defaultOption', () => {
  it('prefers a Q4_K variant among those that fit', () => {
    expect(defaultOption([opt('Q2_K', true), opt('Q4_K_M', true), opt('Q8_0', true)])?.label).toBe('Q4_K_M')
  })
  it('never picks a variant that does not fit when another does', () => {
    expect(defaultOption([opt('Q4_K_M', false), opt('Q2_K', true)])?.label).toBe('Q2_K')
  })
  it('falls back to all the options when none fits, then to the middle one', () => {
    expect(defaultOption([opt('Q4_K_M', false), opt('Q8_0', false)])?.label).toBe('Q4_K_M')
    expect(defaultOption([opt('A'), opt('B'), opt('C')])?.label).toBe('B')
  })
  it('is null without options', () => {
    expect(defaultOption([])).toBeNull()
  })
})

describe('selection and blocking', () => {
  const options = [opt('Q4_K_M', true), opt('Q8_0', false)]
  it('keeps the user pick, else the default', () => {
    expect(chosenOption(options, 'Q8_0')?.label).toBe('Q8_0')
    expect(chosenOption(options, 'gone')?.label).toBe('Q4_K_M')
    expect(chosenOption(options, null)?.label).toBe('Q4_K_M')
  })
  it('blocks adding when the machine cannot run the model or the chosen variant does not fit', () => {
    expect(isAddBlocked({ compatible: true }, options[0])).toBe(false)
    expect(isAddBlocked({ compatible: true }, options[1])).toBe(true)
    expect(isAddBlocked({ compatible: false }, options[0])).toBe(true)
    expect(isAddBlocked(undefined, null)).toBe(true)
  })
  it('a variant with no verdict is not struck through', () => {
    expect(optionDoesNotFit(opt('A'))).toBe(false)
    expect(optionDoesNotFit(opt('A', false))).toBe(true)
  })
  it('the download is the file plus the missing shared files of the reference model', () => {
    expect(optionDownloadGb({ size_gb: 4.29 })).toBe(4.29)
    expect(optionDownloadGb({ size_gb: 4.29, download_gb: 11.16 })).toBe(11.16)
    expect(sharedDownloadGb({ size_gb: 4.29, download_gb: 11.16 })).toBe(6.87)
    expect(sharedDownloadGb({ size_gb: 4.29, download_gb: 4.29 })).toBe(0)
    expect(sharedDownloadGb({ size_gb: 4.29 })).toBe(0)
  })
})
