/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Languages a voice sample can be spoken in (endonyms: they are not translated). */
export const VOICE_LANGUAGES = [
  ['fr', 'Français'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'],
  ['nl', 'Nederlands'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский'],
] as const

/** Default language of a new voice sample. */
export const DEFAULT_VOICE_LANGUAGE = 'fr'

/**
 * Text read aloud while recording: varied vowels, consonants and intonation, about 20 s at a calm pace. It is data in
 * the language of the sample (not a UI text), kept word for word from the former interface.
 */
export const READING: Record<string, string> = {
  fr: "Le matin, quand la ville s'éveille, j'aime marcher lentement le long du fleuve. L'air est frais, les péniches glissent sans un bruit, et quelque part une boulangerie ouvre ses portes. Est-ce que vous avez déjà remarqué à quel point le silence peut être beau ?",
  en: 'In the morning, when the city wakes up, I like to walk slowly along the river. The air is cool, the barges glide by without a sound, and somewhere a bakery opens its doors. Have you ever noticed how beautiful silence can be?',
}

/** Reading text for a language: French and English have their own, any other language reads the English one. */
export function readingFor(language: string): string {
  return READING[language] ?? READING['en']
}
