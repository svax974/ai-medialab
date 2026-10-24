/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { MAX_OCR_PAGES, parsePageSpec } from './pageSpec';

describe('parsePageSpec', () => {
  it('means all pages when empty', () => {
    expect(parsePageSpec(undefined)).toBeNull();
    expect(parsePageSpec('  ')).toBeNull();
  });

  it('reads numbers and ranges, sorted and without duplicates', () => {
    expect(parsePageSpec('5, 1-3,2')).toEqual([1, 2, 3, 5]);
    expect(parsePageSpec(' 7 ')).toEqual([7]);
  });

  it.each(['a', '0', '3-1', '1-', '1,,2', '1-2-3', '-4', String(MAX_OCR_PAGES + 1) + '-' + String(MAX_OCR_PAGES * 3)])('refuses %j', (text) => {
    expect(parsePageSpec(text)).toBeUndefined();
  });
});
