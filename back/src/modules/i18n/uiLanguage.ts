/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export const UI_LANGUAGES = ['fr', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en';

/**
 * The language of the interface, as last announced by the browser. The app is single-user, so one value is enough and
 * it also serves what runs outside a request (the generation queue, engine progress): they speak the language the user
 * last used.
 */
let current: UiLanguage = DEFAULT_UI_LANGUAGE;

/**
 * First supported language of an `Accept-Language` value (`fr`, `fr-FR,fr;q=0.9,en;q=0.8`), in the order given; `null`
 * when it names none (an absent header, `de`, `*`).
 */
export function parseAcceptLanguage(header: string | undefined): UiLanguage | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    const found = UI_LANGUAGES.find((lang) => lang === tag);
    if (found) return found;
  }
  return null;
}

/** Remembers the language of a request that names one; an absent or unsupported header changes nothing. */
export function noteUiLanguage(header: string | undefined): void {
  const lang = parseAcceptLanguage(header);
  if (lang) current = lang;
}

export function uiLanguage(): UiLanguage {
  return current;
}

/** Tests only. */
export function resetUiLanguage(lang: UiLanguage = DEFAULT_UI_LANGUAGE): void {
  current = lang;
}
