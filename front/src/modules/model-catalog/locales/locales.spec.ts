/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL_HELP, TASK_HELP_KEY, TASK_LABEL_KEY } from '../lib/modelHelp'
import { HUB_HELP_KEY, HUB_PLACEHOLDER_KEY, HUB_TASK_KEY } from '../lib/hubSearch'

const load = (dir: string, lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(dir, `locales.${lang}.json`), 'utf8'))
const fr = load(__dirname, 'fr')
const en = load(__dirname, 'en')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : []
  })
}

/** Literal `models.*` keys written in the sources (template keys with `${}` are covered by the tables below). */
function usedKeys(): string[] {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(/'(models\.[A-Za-z0-9_.]+)'/g)].map((match) => match[1]))]
}

describe('model-catalog locales', () => {
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

  it('defines the keys of the lookup tables and the per-backend, per-kind labels', () => {
    const helpKeys = Object.values(MODEL_HELP).flatMap((help) => Object.values(help))
    const tables = [...helpKeys, ...Object.values(TASK_HELP_KEY), ...Object.values(TASK_LABEL_KEY), ...Object.values(HUB_HELP_KEY), ...Object.values(HUB_PLACEHOLDER_KEY), ...Object.values(HUB_TASK_KEY)]
    const backends = ['mlx', 'torch', 'torchGpu', 'sdcpp', 'audio', 'video', 'demo'].map((b) => `models.backend.${b}`)
    const picker = ['mlx', 'torch', 'sdcpp', 'pack', 'demo', 'video'].map((b) => `models.picker.backend.${b}`)
    const tabs = ['image', 'audio', 'video'].map((k) => `models.tabs.${k}`)
    for (const key of [...tables, ...backends, ...picker, ...tabs]) expect(fr[key], key).toBeDefined()
  })
})
