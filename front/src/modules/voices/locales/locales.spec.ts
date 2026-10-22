/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_HELP } from '../lib/voiceHelp'

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `locales.${lang}.json`), 'utf8'))
const fr = load('fr')
const en = load('en')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : []
  })
}

const usedKeys = (): string[] => {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(/['"`](voices\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('voices locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines every key the sources use and the keys of the help table', () => {
    for (const key of usedKeys()) expect(fr[key], key).toBeDefined()
    for (const key of Object.values(VOICE_HELP).flatMap((entry) => Object.values(entry))) expect(fr[key], key).toBeDefined()
  })

  it('keeps the French of the former voice screens', () => {
    expect(fr['voices.page.title']).toBe('Mes voix')
    expect(fr['voices.card.use']).toBe('Écrire avec cette voix')
    expect(fr['voices.studio.title.new']).toBe('Nouvelle voix')
    expect(fr['voices.transcript.auto']).toBe('Transcrire automatiquement')
    expect(fr['voices.help.transcript.body']).toMatch(/^Texte exact prononcé dans l'extrait\./)
    expect(fr['voices.help.sample.tip']).toBe('10 à 30 s, une seule voix, sans musique, sans écho ni bruit de fond.')
    expect(fr['voices.error.tooShort']).toBe('Extrait trop court : il faut au moins une seconde de parole.')
  })
})
