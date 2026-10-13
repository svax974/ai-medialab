/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARAM_HELP } from '../lib/paramHelp'

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

/** Literal `thread.*` keys written in the sources (keys built with `${}` are covered by the tables below). */
function usedKeys(): string[] {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(/['"`](thread\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('studio-core locales', () => {
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

  it('defines the keys built per kind of creation', () => {
    const kinds = ['image', 'audio', 'video']
    const perKind = ['thread.count', 'thread.empty', 'thread.deleteMessage.description', 'thread.deleteGeneration.title', 'thread.deleteGeneration.description', 'thread.footer.delete', 'thread.user.copy']
    for (const prefix of perKind) for (const kind of kinds) expect(fr[`${prefix}.${kind}`], `${prefix}.${kind}`).toBeDefined()
  })

  it('defines the texts of every parameter help', () => {
    for (const [name, help] of Object.entries(PARAM_HELP)) {
      for (const id of [help.titleId, help.bodyId, help.tipId]) if (id) expect(fr[id], `${name}: ${id}`).toBeDefined()
    }
  })

  it('keeps the French of the former interface for the help of the parameters', () => {
    expect(fr['thread.help.guidance.title']).toBe('Guidance (CFG)')
    expect(fr['thread.help.seed.title']).toBe('Graine (seed)')
    expect(fr['thread.footer.vary.title']).toBe('Nouvelles variantes (graines aléatoires)')
  })
})
