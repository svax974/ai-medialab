/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIAGRAM_THEMES, DIAGRAM_TYPES } from '../types'
import { SUGGESTIONS } from '../lib/suggestions'

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
  return [...new Set([...text.matchAll(/['"`](diagramStudio\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('diagram-studio locales', () => {
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

  it('defines a label and a hint for every diagram type, and a label for every theme', () => {
    for (const type of DIAGRAM_TYPES) {
      expect(fr[`diagramStudio.type.${type}`], type).toBeDefined()
      expect(fr[`diagramStudio.type.${type}.hint`], type).toBeDefined()
    }
    for (const theme of DIAGRAM_THEMES) expect(fr[`diagramStudio.theme.${theme}`], theme).toBeDefined()
  })

  it('defines the label and prompt of every starter suggestion', () => {
    for (const s of SUGGESTIONS) {
      expect(fr[s.labelKey], s.labelKey).toBeDefined()
      expect(fr[s.promptKey], s.promptKey).toBeDefined()
    }
  })
})
