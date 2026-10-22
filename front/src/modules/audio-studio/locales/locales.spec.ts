/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIO_HELP, AUDIO_SUGGESTIONS } from '../lib/audioHelp'

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
  return [...new Set([...text.matchAll(/['"`](audioStudio\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('audio-studio locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines every key the sources use and the keys of the lookup tables', () => {
    for (const key of usedKeys()) expect(fr[key], key).toBeDefined()
    const help = Object.values(AUDIO_HELP).flatMap((entry) => Object.values(entry))
    const suggestions = AUDIO_SUGGESTIONS.flatMap((s) => [s.labelKey, s.textKey])
    for (const key of [...help, ...suggestions]) expect(fr[key], key).toBeDefined()
  })

  it('keeps the French of the former audio screens', () => {
    expect(fr['audioStudio.suggestion.dialogue.text']).toBe("Alice : Tu as vu la lumière, ce matin ? On dirait qu'elle vient d'un autre siècle.\nMarc : Je croyais que c'était le lever du soleil.\nAlice : Justement. C'est ce que je dis.")
    expect(`${fr['audioStudio.home.title.before']} ${fr['audioStudio.home.title.accent']}${fr['audioStudio.home.title.after']}`).toBe('Que voulez-vous faire entendre ?')
    expect(fr['audioStudio.help.script.body']).toMatch(/^Écrivez chaque réplique en début de ligne/)
    expect(fr['audioStudio.help.instructDesign.tip']).toMatch(/^exemple : « femme de 30 ans/)
    expect(fr['audioStudio.prompt.placeholder']).toBe('Le texte à lire à voix haute… (« Alice : … » / « Marc : … » pour un dialogue à plusieurs voix)')
    expect(fr['audioStudio.take.voiceSaved']).toBe('« {0} » ajoutée à vos voix')
  })
})
