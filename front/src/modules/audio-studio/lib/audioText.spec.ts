/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { approxDuration, estimateSeconds, speakersIn } from './audioText'

describe('estimateSeconds', () => {
  it('reads about 15 characters per second, whitespace collapsed, faster or slower with the speed (never under 0.5)', () => {
    expect(estimateSeconds('x'.repeat(150))).toBe(10)
    expect(estimateSeconds('a   b\n\n c')).toBeCloseTo(5 / 15)
    expect(estimateSeconds('x'.repeat(150), 2)).toBe(5)
    expect(estimateSeconds('x'.repeat(150), 0.1)).toBe(20)
    expect(estimateSeconds('')).toBe(0)
  })
})

describe('approxDuration', () => {
  it('gives seconds under a minute (at least 1), then minutes with zero-padded seconds', () => {
    expect(approxDuration(0.2)).toEqual({ key: 'audioStudio.approx.seconds', params: [1] })
    expect(approxDuration(12.4)).toEqual({ key: 'audioStudio.approx.seconds', params: [12] })
    expect(approxDuration(65)).toEqual({ key: 'audioStudio.approx.minutes', params: [1, '05'] })
    expect(approxDuration(120)).toEqual({ key: 'audioStudio.approx.minutes', params: [2, '00'] })
  })
})

describe('speakersIn', () => {
  it('finds the names that open a line with some text, in order, once each', () => {
    expect(speakersIn('Alice : Bonjour\nMarc : Salut\nAlice : Ça va ?')).toEqual(['Alice', 'Marc'])
  })

  it('accepts brackets, a full-width colon and accents, and ignores a name without text or a plain sentence', () => {
    expect(speakersIn('[Marc] : Salut\n(Léa)：Coucou\nÉlodie :\nUne phrase sans personnage.')).toEqual(['Marc', 'Léa'])
  })

  it('does not take a long sentence before a colon for a name', () => {
    expect(speakersIn('Voici une très très longue introduction qui dépasse largement la limite : suite')).toEqual([])
    expect(speakersIn('')).toEqual([])
  })
})
