/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OCR_EXPORT_FORMATS } from '../types'

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
  return [...new Set([...text.matchAll(/['"`](ocrStudio\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1]))]
}

describe('ocr-studio locales', () => {
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

  it('defines a label for every dynamic key: tasks with their hint, statuses, export formats', () => {
    for (const task of ['default', 'text', 'markdown', 'table', 'formula', 'chart', 'custom']) {
      expect(fr[`ocrStudio.task.${task}`], task).toBeDefined()
      expect(fr[`ocrStudio.task.${task}.hint`], task).toBeDefined()
    }
    for (const status of ['queued', 'running', 'done', 'failed', 'cancelled']) expect(fr[`ocrStudio.status.${status}`], status).toBeDefined()
    for (const format of OCR_EXPORT_FORMATS) expect(fr[`ocrStudio.export.${format}`], format).toBeDefined()
  })
})
