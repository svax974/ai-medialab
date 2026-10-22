/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IMAGE_HELP, SUGGESTIONS } from '../lib/help'
import { ASPECTS, QUALITIES } from '../lib/size'
import { referenceRole } from '../lib/composerRules'

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

function usedKeys(): string[] {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(/['"`](imageStudio\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('image-studio locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines every key the sources use', () => {
    for (const key of usedKeys()) expect(fr[key], key).toBeDefined()
  })

  it('defines the keys of the lookup tables', () => {
    const help = Object.values(IMAGE_HELP).flatMap((entry) => Object.values(entry))
    const suggestions = SUGGESTIONS.flatMap((s) => [s.labelKey, s.promptKey])
    const aspects = ASPECTS.map((a) => a.labelKey)
    const qualities = QUALITIES.flatMap((q) => [q.labelKey, q.hintKey])
    const roles = [0, 1, 2, 3].flatMap((index) =>
      (['none', 'init', 'multi'] as const).flatMap((mode) => {
        const role = referenceRole({ name: 'M', reference_mode: mode, max_references: 2 }, index)
        return [role.noteKey, role.helpKey]
      }),
    )
    for (const key of [...help, ...suggestions, ...aspects, ...qualities, ...roles]) expect(fr[key], key).toBeDefined()
  })

  it('keeps the French of the former interface for the suggestions and the headline', () => {
    expect(fr['imageStudio.suggestion.portrait.prompt']).toBe("Portrait en clair-obscur d'une vieille horlogère dans son atelier, loupe à l'œil, poussière dans un rai de lumière, pellicule Portra 400, grain fin")
    expect(`${fr['imageStudio.home.title.before']} ${fr['imageStudio.home.title.accent']}${fr['imageStudio.home.title.after']}`).toBe('Que voulez-vous révéler ?')
  })
})
