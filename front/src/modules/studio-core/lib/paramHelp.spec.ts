/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { PARAM_HELP, paramHelp } from './paramHelp'

const t = (key: string) => `«${key}»`

describe('paramHelp', () => {
  it('gives the generic text of a known key', () => {
    expect(paramHelp({ key: 'steps', label: 'Étapes', help: '' }, 'image', t)).toEqual({
      title: '«thread.help.steps.title»',
      body: '«thread.help.steps.body»',
      tip: '«thread.help.steps.tip»',
    })
  })

  it('uses the video wording of the influence parameter for a video model', () => {
    expect(paramHelp({ key: 'strength', label: 'Influence', help: '' }, 'video', t).title).toBe('«thread.help.strength_video.title»')
    expect(paramHelp({ key: 'strength', label: 'Influence', help: '' }, 'image', t).title).toBe('«thread.help.strength.title»')
  })

  it('adds the model caveat after "this model"', () => {
    const help = paramHelp({ key: 'guidance', label: 'Guidance', help: 'À 1, désactivée sur ce modèle.' }, 'image', t)
    expect(help.body).toBe('«thread.help.guidance.body»\n\n«thread.help.modelSays» À 1, désactivée sur ce modèle.')
  })

  it('skips an engine text that only repeats the generic explanation', () => {
    expect(paramHelp({ key: 'steps', label: 'Étapes', help: 'Plus d\'étapes = plus de détails, plus lent.' }, 'image', t).body).toBe('«thread.help.steps.body»')
  })

  it('falls back to the model text, then to the label, for an unknown key', () => {
    expect(paramHelp({ key: 'exaggeration', label: 'Exagération', help: 'Intensité.' }, 'image', t)).toEqual({ title: 'Exagération', body: 'Intensité.' })
    expect(paramHelp({ key: 'x', label: 'Libellé', help: '  ' }, 'image', t)).toEqual({ title: 'Libellé', body: 'Libellé' })
  })

  it('has a title and body key for every entry', () => {
    for (const help of Object.values(PARAM_HELP)) expect(help.titleId && help.bodyId).toBeTruthy()
  })
})
