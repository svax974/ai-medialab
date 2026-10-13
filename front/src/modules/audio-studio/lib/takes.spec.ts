/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset, Message } from '@/modules/studio-core'
import { audioDownloadName, isFreshTake, markerPosition, reusedAudio, shouldAutoplay, speakerColors, takeFraction, takeLabel, takeMeta, takeSlots, voiceFromTake } from './takes'

const asset = (meta: Record<string, unknown> = {}, extra: Partial<Asset> = {}): Asset => ({ id: 't1', kind: 'generated', media: 'audio', duration: 12, url: '/media/outputs/t1.wav', thumb_url: '', width: null, height: null, seed: 7, original_name: null, favorite: false, meta, conversation_id: 'c1', message_id: 'a1', created_at: 1000, ...extra })

describe('takeMeta', () => {
  it('reads the peaks, the named markers, the voice, text, style and language', () => {
    const meta = takeMeta(asset({ peaks: [0.1, 0.5], markers: [{ start: 0, label: 'Alice', segment: 0 }, { start: 3.2, label: null }, { start: 'x', label: 'Marc' }, { start: 5, label: 'Marc' }], voice: 'Siwis', prompt: 'Bonjour', instruct: 'doux', language: 'fr' }))
    expect(meta).toEqual({ peaks: [0.1, 0.5], markers: [{ start: 0, label: 'Alice', segment: 0 }, { start: 5, label: 'Marc' }], voice: 'Siwis', prompt: 'Bonjour', instruct: 'doux', language: 'fr' })
  })

  it('defaults everything for an old or odd take', () => {
    expect(takeMeta(asset({ peaks: 'no', markers: 3, voice: 4 }))).toEqual({ peaks: [], markers: [], voice: null, prompt: '', instruct: '', language: '' })
  })
})

describe('takeSlots', () => {
  const message = (status: Message['status'], outputs: Asset[], count: number) => ({ status, outputs, params: { count } })

  it('shows the produced takes, then a placeholder per take to come while the generation goes on', () => {
    const slots = takeSlots(message('running', [asset()], 3), 1)
    expect(slots.map((s) => s.kind)).toEqual(['take', 'pending', 'pending'])
    expect(slots[1]).toEqual({ kind: 'pending', running: true })
    expect(slots[2]).toEqual({ kind: 'pending', running: false })
  })

  it('computes only the current take while running, nothing while loading or waiting, and no placeholder once finished', () => {
    expect(takeSlots(message('loading', [], 2), undefined)).toEqual([{ kind: 'pending', running: false }, { kind: 'pending', running: false }])
    expect(takeSlots(message('queued', [], 1), undefined)).toEqual([{ kind: 'pending', running: false }])
    expect(takeSlots(message('running', [], 1), undefined)).toEqual([{ kind: 'pending', running: true }])
    expect(takeSlots(message('done', [asset()], 3), undefined)).toHaveLength(1)
    expect(takeSlots(message('error', [], 2), undefined)).toEqual([])
  })

  it('shows the progress of the take being computed, bounded', () => {
    expect(takeFraction({ step: 3, total: 4 }, true)).toBe(0.75)
    expect(takeFraction({ step: 9, total: 4 }, true)).toBe(1)
    expect(takeFraction({ step: 3, total: 4 }, false)).toBe(0)
    expect(takeFraction(undefined, true)).toBe(0)
  })
})

describe('labels, colors, markers', () => {
  it('labels a take: its number only when there are several, its voice and its seed', () => {
    expect(takeLabel(asset({ voice: 'Siwis' }), 1, 3)).toEqual([{ kind: 'take', number: 2 }, { kind: 'voice', name: 'Siwis' }, { kind: 'seed', seed: 7 }])
    expect(takeLabel(asset({}, { seed: null }), 0, 1)).toEqual([])
  })

  it('gives each character a colour in order of first appearance, the first with the accent, cycling after six', () => {
    const colors = speakerColors(['A', 'B', 'A', 'C'])
    expect(Object.keys(colors)).toEqual(['A', 'B', 'C'])
    expect(colors['A']).toBe('var(--safe)')
    expect(new Set(Object.values(colors)).size).toBe(3)
    expect(speakerColors(['1', '2', '3', '4', '5', '6', '7'])['7']).toBe('var(--safe)')
  })

  it('places a marker as a share of the duration, bounded, and at 0 when the duration is unknown', () => {
    expect(markerPosition(5, 20)).toBe(25)
    expect(markerPosition(30, 20)).toBe(100)
    expect(markerPosition(-1, 20)).toBe(0)
    expect(markerPosition(5, 0)).toBe(0)
  })

  it('names the download after the text (slug, accents removed), the seed or the id, as a WAV', () => {
    expect(audioDownloadName(asset({ prompt: 'Il était une fois… un chat !' }))).toBe('il-etait-une-fois-un-chat-7.wav')
    expect(audioDownloadName(asset({}, { seed: null }))).toBe('audio-t1.wav')
    expect(audioDownloadName(asset({ prompt: 'x'.repeat(100) })).length).toBeLessThanOrEqual(40 + '-7.wav'.length)
  })

  it('reveals a take produced less than 8 s ago', () => {
    expect(isFreshTake({ created_at: 1000 }, 1007.9)).toBe(true)
    expect(isFreshTake({ created_at: 1000 }, 1008)).toBe(false)
  })
})

describe('shouldAutoplay', () => {
  const first = { id: 'a', created_at: 1000 }
  const ok = { enabled: true, first, alreadyPlayed: new Set<string>(), nowSeconds: 1002, playing: false }
  it('starts a fresh first take once, when autoplay is on and nothing is playing', () => {
    expect(shouldAutoplay(ok)).toBe(true)
    expect(shouldAutoplay({ ...ok, enabled: false })).toBe(false)
    expect(shouldAutoplay({ ...ok, first: undefined })).toBe(false)
    expect(shouldAutoplay({ ...ok, alreadyPlayed: new Set(['a']) })).toBe(false)
    expect(shouldAutoplay({ ...ok, nowSeconds: 1100 })).toBe(false) // an old conversation reopened
    expect(shouldAutoplay({ ...ok, playing: true })).toBe(false)
  })
})

describe('voiceFromTake', () => {
  const labels = { copy: (n: string) => `${n} (copie)`, created: 'Voix créée' }
  it('keeps a take of a described voice as a designed voice named "Voix créée"', () => {
    expect(voiceFromTake(asset({ voice: 'Voix décrite', instruct: 'femme grave', prompt: 'Salut', language: 'fr' }), labels)).toEqual({ asset_id: 't1', name: 'Voix créée', description: 'femme grave', transcript: 'Salut', language: 'fr', kind: 'design' })
  })

  it('keeps a take of a cloned or built-in voice as a copy of it (a clone when it has no description or the voice name has a bracket)', () => {
    expect(voiceFromTake(asset({ voice: 'Siwis', prompt: 'Salut' }), labels)).toMatchObject({ name: 'Siwis (copie)', kind: 'clone', language: null })
    expect(voiceFromTake(asset({ voice: 'Moi (copie)', instruct: 'x' }), labels).kind).toBe('clone')
    expect(voiceFromTake(asset({ voice: 'Siwis', instruct: 'chaleureux' }), labels).kind).toBe('design')
  })
})

describe('reusedAudio', () => {
  it('takes back the voice, language, style, parameters, number of takes and the first seed, without the cast and the internal ones', () => {
    const message = { model_id: 'tts', params: { voice: { source: 'library', id: 'v' }, language: 'fr', instruct: 'doux', seeds: [5, 6], count: 2, steps: 1, seed: null, speed: 1.2, cast: { A: 1 }, references_used: 0 } } as never
    expect(reusedAudio(message)).toEqual({ modelId: 'tts', voice: { source: 'library', id: 'v' }, language: 'fr', instruct: 'doux', params: { speed: 1.2 }, count: 2, seed: 5 })
  })

  it('is nothing without a model and tolerates missing fields', () => {
    expect(reusedAudio({ model_id: null, params: {} } as never)).toBeNull()
    expect(reusedAudio({ model_id: 'tts', params: {} } as never)).toEqual({ modelId: 'tts', voice: undefined, language: undefined, instruct: undefined, params: {}, count: null, seed: null })
  })
})
