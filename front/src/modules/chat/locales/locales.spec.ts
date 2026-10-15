/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARAMS_SCHEMA, PERSONA_IDS, PRESET_IDS } from '../lib/presets'
import { chatErrorInfo } from '../lib/errors'
import { refusalKey } from '../lib/attachments'

const load = (module: string, lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `../../${module}/locales/locales.${lang}.json`), 'utf8'))
const fr = load('chat', 'fr')
const en = load('chat', 'en')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : []
  })
}

/** Literal keys written in the sources under a prefix. */
function usedKeys(prefix: string): string[] {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(new RegExp(`['"\`](${prefix}\\.[A-Za-z0-9_.-]+)['"\`]`, 'g'))].map((match) => match[1]))]
}

describe('chat locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim() || key === 'chat.home.title.after', key).toBeTruthy()
      expect(en[key].trim(), key).toBeTruthy()
    }
  })

  it('defines every chat key the sources use', () => {
    for (const key of usedKeys('chat')) expect(fr[key], key).toBeDefined()
  })

  it('defines the keys of the lookup tables and of the dynamic keys', () => {
    const keys = [
      ...PERSONA_IDS.flatMap((id) => [`chat.persona.${id}`, `chat.persona.${id}.prompt`]),
      ...PRESET_IDS.map((id) => `chat.preset.${id}`),
      ...['explain', 'write', 'code', 'imagePrompt'].flatMap((id) => [`chat.suggest.${id}.label`, `chat.suggest.${id}.prompt`]),
      ...['auto', 'off', 'low', 'medium', 'high'].map((id) => `chat.reasoning.level.${id}`),
      ...['idle', 'loading', 'ready', 'generating'].map((id) => `chat.llm.${id}`),
      ...['type', 'size', 'noVision', 'tooMany'].map((r) => refusalKey(r as 'type')),
      ...['busy', 'no_model', 'no_engine', 'context_exceeded', 'refused', 'upstream', 'closed', 'invalid'].map((code) => chatErrorInfo(code).key),
      ...['install-engine', 'choose-model', 'raise-context', 'retry'].map((a) => `chat.error.action.${a}`),
      ...PARAMS_SCHEMA.flatMap((f) => [`chat.params.${f.key}`, `chat.params.${f.key}.help`]),
    ]
    for (const key of keys) expect(fr[key], key).toBeDefined()
  })

  it('defines the keys it borrows from other modules', () => {
    for (const module of ['studio-core', 'studio-shell', 'model-catalog', 'engines', 'settings']) {
      const texts = load(module, 'fr')
      const prefix = { 'studio-core': 'thread', 'studio-shell': 'studio', 'model-catalog': 'models', engines: 'engines', settings: 'settings' }[module] as string
      for (const key of usedKeys(prefix)) expect(texts[key], key).toBeDefined()
    }
  })

  it('says, word for word, that changing the context reloads the model', () => {
    expect(fr['chat.params.context.reload']).toBe('Changer le contexte recharge le modèle (quelques secondes à quelques minutes selon sa taille) ; la mémoire utilisée change aussi.')
    expect(fr['chat.status.reloadContext']).toBe('Rechargement du modèle avec un contexte de {0} tokens…')
  })
})
