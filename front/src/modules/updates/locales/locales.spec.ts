/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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

describe('updates locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines every key the sources use, a label for every kind and filter, and uses every key it defines', () => {
    const text = [...sources(resolve(__dirname, '..')), resolve(__dirname, '../../studio-shell/components/SidebarFooter.tsx')].map((file) => readFileSync(file, 'utf8')).join('\n')
    const used = new Set([...text.matchAll(/['"](updates\.[A-Za-z0-9_.]+)['"]/g)].map((match) => match[1]))
    for (const kind of ['image', 'audio', 'video']) used.add(`updates.kind.${kind}`)
    for (const filter of ['all', 'image', 'audio', 'video']) used.add(`updates.filter.${filter}`)
    for (const verdict of ['none', 'caution', 'discouraged']) used.add(`updates.advice.badge.${verdict}`)
    for (const key of used) expect(fr[key], key).toBeDefined()
    for (const key of Object.keys(fr)) expect(used.has(key), `${key} is not used`).toBe(true)
  })
})
