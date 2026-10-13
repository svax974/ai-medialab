/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `locales.${lang}.json`), 'utf8'))
const fr = load('fr')
const en = load('en')

describe('media-library locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines the texts of the gallery of every media kind', () => {
    for (const media of ['image', 'audio', 'video']) {
      for (const part of ['title', 'count', 'search', 'empty', 'emptyFavorites']) expect(fr[`library.${media}.${part}`], `${media}.${part}`).toBeDefined()
    }
    for (const mode of ['audio', 'video']) for (const part of ['title', 'body', 'ignored']) expect(fr[`library.drop.${mode}.${part}`], `drop.${mode}.${part}`).toBeDefined()
  })

  it('keeps the French of the former galleries', () => {
    expect(fr['library.image.title']).toBe('Galerie')
    expect(fr['library.image.count']).toBe('{0} tirages')
    expect(fr['library.image.search']).toBe('Filtrer par prompt')
    expect(fr['library.image.emptyFavorites']).toBe("Aucun favori pour l'instant — utilisez ♥ sur une image.")
    expect(fr['library.audio.count']).toBe('{0} prises')
    expect(fr['library.video.count']).toBe('{0} clips')
    expect(fr['library.drop.audio.ignored']).toBe('Déposez un fichier audio (WAV, MP3, M4A, FLAC, OGG…).')
  })
})
