/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export type LocaleFiles = Record<string, Record<string, string>>

/** Merges the files by language: `{ fr: {...}, en: {...} }`. */
export function mergeLocaleFiles(localeFiles: LocaleFiles): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {}
  for (const [path, keys] of Object.entries(localeFiles)) {
    const lang = path.match(/locales\.([^.]+)\.json$/)?.[1]
    if (lang) merged[lang] = { ...merged[lang], ...keys }
  }
  return merged
}
