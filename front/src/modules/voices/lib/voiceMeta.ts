/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Voice } from '../types'

/** Hue (0..359) of the avatar of a name: stable, so a voice keeps its colour. */
export function avatarHue(name: string): number {
  let hue = 0
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360
  return hue
}

/** Background of the round avatar of a voice. */
export function avatarGradient(name: string): string {
  const hue = avatarHue(name)
  return `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))`
}

/** Initial shown in the avatar of a built-in voice. */
export const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

export type VoiceFact = { kind: 'type'; key: 'voices.card.kind.clone' | 'voices.card.kind.design' } | { kind: 'language'; code: string } | { kind: 'duration'; seconds: number } | { kind: 'noTranscript' }

/** The small facts under the name of a voice, in order: kind, language, duration, a missing transcript. */
export function voiceFacts(voice: Pick<Voice, 'kind' | 'language' | 'duration' | 'transcript'>): VoiceFact[] {
  const facts: VoiceFact[] = [{ kind: 'type', key: voice.kind === 'design' ? 'voices.card.kind.design' : 'voices.card.kind.clone' }]
  if (voice.language) facts.push({ kind: 'language', code: voice.language })
  if (voice.duration) facts.push({ kind: 'duration', seconds: voice.duration })
  if (!voice.transcript) facts.push({ kind: 'noTranscript' })
  return facts
}

/** Sentence quoted under a voice card: its transcript, else its description; `null` when neither. */
export function voiceQuote(voice: Pick<Voice, 'transcript' | 'description'>): string | null {
  return voice.transcript || voice.description || null
}
