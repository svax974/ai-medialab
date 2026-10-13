/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { AudioCaps } from '@/modules/model-catalog'
import type { Voice, VoiceRef } from '@/modules/voices'

type Preset = AudioCaps['voices'][number]

/** Built-in voices of the model for the text's language (a voice marked `*` fits every language). */
export function presetsFor(caps: AudioCaps, language: string): Preset[] {
  return caps.voices.filter((voice) => voice.language === language || voice.language === '*')
}

/** Language used: the stored choice if the model has it, else the interface language, else French, else the model's first. */
export function defaultLanguage(caps: AudioCaps, stored: string | undefined, uiLanguage: string): string {
  const codes = caps.languages.map((language) => language.code)
  if (stored && codes.includes(stored)) return stored
  const ui = (uiLanguage || 'fr').slice(0, 2)
  return codes.includes(ui) ? ui : codes.includes('fr') ? 'fr' : (codes[0] ?? 'en')
}

export interface EffectiveVoice {
  ref: VoiceRef | undefined
  name: string
  preset?: Preset
  voice?: Voice
}

/** The voice actually used: the library voice chosen (if the model can clone), else the chosen built-in one, else the model's first. */
export function effectiveVoice(caps: AudioCaps, ref: VoiceRef | undefined, language: string, library: readonly Voice[] | undefined): EffectiveVoice {
  if (ref?.source === 'library') {
    const voice = library?.find((candidate) => candidate.id === ref.id)
    if (voice && caps.clone !== 'none') return { ref, name: voice.name, voice }
  }
  const presets = presetsFor(caps, language)
  const preset = (ref?.source === 'preset' && presets.find((candidate) => candidate.id === ref.id)) || presets[0]
  if (preset) return { ref: { source: 'preset', id: preset.id }, name: preset.name, preset }
  return { ref: undefined, name: '' }
}

const same = (a: VoiceRef, b: VoiceRef | undefined) => !!b && a.source === b.source && a.id === b.id

/** Voices a character can be given: the model's built-in ones for the language, and the library when the model can clone. */
export function castPool(caps: AudioCaps, language: string, library: readonly Voice[] | undefined): VoiceRef[] {
  return [
    ...presetsFor(caps, language).map((preset): VoiceRef => ({ source: 'preset', id: preset.id })),
    ...(caps.clone !== 'none' ? (library ?? []).map((voice): VoiceRef => ({ source: 'library', id: voice.id })) : []),
  ]
}

/**
 * Voice of the character number `index` of a script: the user's choice if it is still available, else automatic casting:
 * the first character keeps the selected voice, the others get other voices (voices of the opposite gender first, to
 * tell the characters apart).
 */
export function castVoiceFor(input: {
  name: string
  index: number
  cast: Record<string, VoiceRef | undefined>
  pool: readonly VoiceRef[]
  main: EffectiveVoice
  caps: AudioCaps
}): VoiceRef | undefined {
  const { name, index, cast, pool, main, caps } = input
  const chosen = cast[name]
  if (chosen && pool.some((candidate) => same(candidate, chosen))) return chosen
  if (index === 0 && main.ref) return main.ref
  const others = pool.filter((candidate) => !same(candidate, main.ref))
  const genderOf = (ref: VoiceRef) => caps.voices.find((voice) => ref.source === 'preset' && voice.id === ref.id)?.gender
  const mainGender = main.preset?.gender
  const opposite = others.filter((ref) => mainGender && genderOf(ref) && genderOf(ref) !== mainGender)
  const list = opposite.length ? [...opposite, ...others.filter((ref) => !opposite.includes(ref))] : others.length ? others : [...pool]
  return list[(index - 1) % list.length]
}

/** A dialogue is cast when the text names at least two characters, the user did not say "it is plain text", the model does not invent voices and a voice can be given. */
export function isScriptActive(input: { scriptMode: boolean; speakers: readonly string[]; caps: AudioCaps; poolSize: number }): boolean {
  return input.scriptMode && input.speakers.length >= 2 && !input.caps.design && input.poolSize > 0
}
