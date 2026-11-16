/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import fs from 'fs';
import path from 'path';
import { UI_LANGUAGES, uiLanguage, type UiLanguage } from './uiLanguage';

type Dictionary = Record<string, string>;

let dictionaries: Record<UiLanguage, Dictionary> | null = null;

/** App dictionaries: source tree in development, staged resources on desktop, source fallback in other builds. */
export function resolveModulesRoot(moduleDir: string): string {
  const inSource = path.resolve(moduleDir, '..');
  if (!moduleDir.includes(`${path.sep}dist${path.sep}`)) return inSource;
  const packaged = path.resolve(moduleDir, '../../../../app-locales');
  return fs.existsSync(packaged) ? packaged : path.resolve(moduleDir, '../../../src/modules');
}

/** Every `src/modules/<module>/i18n/*.<lang>.json` merged per language (flat key maps, keys `<module>.…`). */
export function loadDictionaries(root: string = resolveModulesRoot(__dirname)): Record<UiLanguage, Dictionary> {
  const merged = Object.fromEntries(UI_LANGUAGES.map((lang) => [lang, {} as Dictionary])) as Record<UiLanguage, Dictionary>;
  if (!fs.existsSync(root)) return merged;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    const folder = path.join(root, dir.name, 'i18n');
    if (!dir.isDirectory() || !fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder)) {
      const lang = file.split('.').slice(-2)[0] as UiLanguage;
      if (!file.endsWith('.json') || !UI_LANGUAGES.includes(lang)) continue;
      Object.assign(merged[lang], JSON.parse(fs.readFileSync(path.join(folder, file), 'utf-8')));
    }
  }
  return merged;
}

/**
 * A message of the server in the language of the interface (`{0}`, `{1}` are replaced by `params`). An unknown key comes
 * back as itself, deliberately: a missing translation must be seen, not hidden behind a default.
 */
export function tr(key: string, params: readonly (string | number)[] = [], lang: UiLanguage = uiLanguage()): string {
  dictionaries ??= loadDictionaries();
  const raw = dictionaries[lang][key];
  if (typeof raw !== 'string') return key;
  return params.reduce<string>((text, value, index) => text.split(`{${index}}`).join(String(value)), raw);
}

/** Tests only: forgets the loaded files. */
export function clearTranslations(): void {
  dictionaries = null;
}
