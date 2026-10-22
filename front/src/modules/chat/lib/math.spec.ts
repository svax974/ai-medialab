/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { mayHaveMath, normalizeMath } from './math'

describe('mayHaveMath', () => {
  it('is cheap and true only when a formula marker is present', () => {
    expect(mayHaveMath('du texte simple, 5 € ou 6 €')).toBe(false)
    expect(mayHaveMath('soit $x$')).toBe(true)
    expect(mayHaveMath('\\(a\\)')).toBe(true)
    expect(mayHaveMath('\\[a\\]')).toBe(true)
    expect(mayHaveMath('$$a$$')).toBe(true)
  })
})

describe('normalizeMath', () => {
  it('writes \\( … \\) and \\[ … \\] as $$ formulas', () => {
    expect(normalizeMath('Soit \\(x^2\\) positif')).toBe('Soit $$x^2$$ positif')
    expect(normalizeMath('Alors :\n\\[ E = mc^2 \\]\nfin')).toBe('Alors :\n\n$$\nE = mc^2\n$$\n\nfin')
  })

  it('turns $x$ into a formula, but keeps prices and amounts as text', () => {
    expect(normalizeMath('Soit $x+1$ et $y$.')).toBe('Soit $$x+1$$ et $$y$$.')
    expect(normalizeMath('Cela coûte $5 et $6 au total')).toBe('Cela coûte $5 et $6 au total')
    expect(normalizeMath('de 5$ à 10$')).toBe('de 5$ à 10$')
    expect(normalizeMath('un \\$ échappé et $ seul')).toBe('un \\$ échappé et $ seul')
  })

  it('leaves $$ formulas as they are', () => {
    expect(normalizeMath('$$a+b$$')).toBe('$$a+b$$')
    expect(normalizeMath('$$\na+b\n$$')).toBe('$$\na+b\n$$')
  })

  it('never touches code: fenced blocks, inline code, or a fence still open while the answer is written', () => {
    const fenced = 'Voici :\n```js\nconst s = `$x$`; // \\(y\\)\n```\net $z$'
    expect(normalizeMath(fenced)).toBe('Voici :\n```js\nconst s = `$x$`; // \\(y\\)\n```\net $$z$$')
    expect(normalizeMath('la variable `$HOME` et \\(a\\)')).toBe('la variable `$HOME` et $$a$$')
    expect(normalizeMath('avant $a$\n```py\nprix = "$b$"')).toBe('avant $$a$$\n```py\nprix = "$b$"')
  })

  it('does not change a text without a formula marker', () => {
    const text = '# Titre\n\nDu **gras** et une liste :\n- un\n- deux'
    expect(normalizeMath(text)).toBe(text)
  })
})
