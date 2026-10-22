/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENGINE_IDS } from '../lib/installState'

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

describe('engines locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  it('defines every key the sources use, and the name and hint of every engine', () => {
    const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
    const keys = [...new Set([...text.matchAll(/'(engines\.[A-Za-z0-9_.]+)'/g)].map((match) => match[1]))]
    for (const key of keys) expect(fr[key], key).toBeDefined()
    for (const id of ENGINE_IDS) {
      expect(fr[`engines.engine.${id}.name`]).toBeDefined()
      expect(fr[`engines.engine.${id}.hint`]).toBeDefined()
    }
  })
})
