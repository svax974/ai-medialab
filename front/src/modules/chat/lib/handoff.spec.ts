/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { handoffText, promptFromMarkdown } from './handoff'

describe('promptFromMarkdown', () => {
  it('drops heading, emphasis, quote and list marks and keeps the words', () => {
    expect(promptFromMarkdown('# Un renard\n\nUn **renard roux** dans la *neige*, ~~sans~~ avec _brume_.')).toBe('Un renard\n\nUn renard roux dans la neige, sans avec brume.')
    expect(promptFromMarkdown('> citation\n\n- un\n* deux\n1. trois\n2) quatre')).toBe('citation\n\nun\ndeux\ntrois\nquatre')
  })

  it('keeps the text of a link and drops an image', () => {
    expect(promptFromMarkdown('Voir [la photo](https://example.org/a.png) ![x](https://example.org/y.png) ici')).toBe('Voir la photo  ici')
  })

  it('keeps the content of a code block as text, and an empty block vanishes', () => {
    expect(promptFromMarkdown('Avant\n```text\nun chien\nqui court\n```\nAprès')).toBe('Avant\nun chien\nqui court\nAprès')
    expect(promptFromMarkdown('Avant\n```\n```\nAprès')).toBe('Avant\nAprès')
    expect(promptFromMarkdown('Texte\n```python\nprint(1)')).toBe('Texte\nprint(1)')
  })

  it('unwraps inline code, squeezes blank lines and removes rules and trailing spaces', () => {
    expect(promptFromMarkdown('Un `mot`   \n\n\n\n---\n\nFin  ')).toBe('Un mot\n\nFin')
  })

  it('does not touch snake_case words, products of numbers or a lone star', () => {
    expect(promptFromMarkdown('le_fichier_nom et 3 * 4 = 12, 2*3*4')).toBe('le_fichier_nom et 3 * 4 = 12, 2*3*4')
  })

  it('is empty for an answer that is only marks', () => {
    expect(promptFromMarkdown('```\n```\n\n---\n')).toBe('')
  })
})

describe('handoffText', () => {
  it('uses the selection when there is one, the whole answer otherwise', () => {
    expect(handoffText('# Tout\n\ntexte', '  **la partie**  ')).toBe('la partie')
    expect(handoffText('# Tout\n\ntexte', '   ')).toBe('Tout\n\ntexte')
    expect(handoffText('# Tout', '')).toBe('Tout')
  })
})
