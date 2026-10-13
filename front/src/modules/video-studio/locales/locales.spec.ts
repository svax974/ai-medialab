/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SLOT_WHY_KEY } from '../lib/slots'
import { VIDEO_ASPECTS } from '../lib/videoMath'
import { VARY_HELP, VIDEO_HELP, VIDEO_SUGGESTIONS } from '../lib/videoHelp'

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `locales.${lang}.json`), 'utf8'))
const fr = load('fr')
const en = load('en')
const studioCore = JSON.parse(readFileSync(resolve(__dirname, '../../studio-core/locales/locales.fr.json'), 'utf8')) as Record<string, string>
const catalog = JSON.parse(readFileSync(resolve(__dirname, '../../model-catalog/locales/locales.fr.json'), 'utf8')) as Record<string, string>

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : []
  })
}

/** Literal keys written in the sources (`videoStudio.*` here; `thread.*` and `models.*` of the modules it borrows from). */
function usedKeys(prefix: string): string[] {
  const text = sources(resolve(__dirname, '..')).map((file) => readFileSync(file, 'utf8')).join('\n')
  return [...new Set([...text.matchAll(new RegExp(`['"\`](${prefix}\\.[A-Za-z0-9_.]+)['"\`]`, 'g'))].map((match) => match[1]))]
}

describe('video-studio locales', () => {
  it('fr and en define the same keys, with the same placeholders and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join()
    for (const key of Object.keys(fr)) {
      expect(placeholders(en[key]), key).toBe(placeholders(fr[key]))
      expect(fr[key].trim() || key === 'videoStudio.home.title.after', key).toBeTruthy()
      expect(en[key].trim() || key === 'videoStudio.home.title.after', key).toBeTruthy()
    }
  })

  it('defines every videoStudio key the sources use', () => {
    for (const key of usedKeys('videoStudio')) expect(fr[key], key).toBeDefined()
  })

  it('defines the thread and models keys it borrows', () => {
    for (const key of usedKeys('thread')) expect(studioCore[key], key).toBeDefined()
    for (const key of usedKeys('models')) expect(catalog[key], key).toBeDefined()
  })

  it('defines the keys of the lookup tables', () => {
    const help = Object.values(VIDEO_HELP).flatMap((entry) => Object.values(entry))
    const suggestions = VIDEO_SUGGESTIONS.flatMap((s) => [s.labelKey, s.promptKey])
    const aspects = VIDEO_ASPECTS.map((a) => a.labelKey)
    const statuses = ['start.required', 'start.optional', 'start.none', 'end.optional', 'end.none', 'source.required', 'source.optional', 'source.none'].map((s) => `videoStudio.help.slot.status.${s}`)
    const footer = [VARY_HELP.titleId, VARY_HELP.bodyId]
    for (const key of [...help, ...suggestions, ...aspects, ...statuses, ...footer, ...Object.values(SLOT_WHY_KEY)]) expect(fr[key], key).toBeDefined()
  })

  it('keeps the starter prompts of the former interface word for word', () => {
    expect(fr['videoStudio.suggestion.urban.prompt']).toBe('Rue de Paris sous la pluie, la nuit, néons qui se reflètent sur les pavés mouillés, passants avec des parapluies, caméra à l\'épaule qui suit une cycliste')
    expect(fr['videoStudio.home.subtitle']).toBe('Décrivez une scène, animez une image — ou déposez une vidéo pour la modifier. Tout est calculé sur cette machine.')
  })
})
