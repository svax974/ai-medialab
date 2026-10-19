/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import axios from 'axios'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { mergeLocaleFiles, type LocaleFiles } from './mergeLocaleFiles'

/**
 * Locales of the app's own modules (`src/modules/<module>/locales`) and themes (`src/themes/<theme>/locales`), as
 * `locales.<lang>.json` flat key maps. The template's LocaleService only globs `modules_shared`, so the app registers
 * its own here (imported once by main.tsx); the keys merge with the remote ones fetched later (`i18n.add` merges).
 * `npm run i18n:check` scans every `locales/` folder of `front/`, so these files are audited like the others.
 */
const files: LocaleFiles = {
  ...import.meta.glob<Record<string, string>>('/src/modules/*/locales/locales.*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<Record<string, string>>('/src/themes/*/locales/locales.*.json', { eager: true, import: 'default' }),
}

i18n.add(mergeLocaleFiles(files))

/**
 * Keeps the interface language where the rest of the app reads it, from boot and on every switch: `<html lang>` (screen
 * readers, hyphenation, spell-check) and the `Accept-Language` header of every request (axios, used by `HttpService`), which
 * is how Nest and the engine write their messages in the language of the interface. `fetch` calls use `languageHeaders()`.
 */
const syncLanguage = (lang: string | undefined): void => {
  if (!lang) return
  document.documentElement.lang = lang
  axios.defaults.headers.common['Accept-Language'] = lang
}
syncLanguage(i18n.getLang())
i18n.addEventListener('languageChanged', (payload: { lang?: string } | string) => syncLanguage(typeof payload === 'string' ? payload : payload?.lang))
