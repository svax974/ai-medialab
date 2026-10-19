/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearTranslations, loadDictionaries, tr } from './tr';
import { parseAcceptLanguage, resetUiLanguage, noteUiLanguage, uiLanguage } from './uiLanguage';

describe('parseAcceptLanguage', () => {
  it('takes the first supported language, in the order given', () => {
    expect(parseAcceptLanguage('fr')).toBe('fr');
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(parseAcceptLanguage('de,en-US;q=0.8')).toBe('en');
  });
  it('is null when none is supported or absent', () => {
    expect(parseAcceptLanguage(undefined)).toBeNull();
    expect(parseAcceptLanguage('de,*')).toBeNull();
  });
});

describe('uiLanguage', () => {
  afterEach(() => resetUiLanguage());
  it('defaults to English and follows the last request that names a language', () => {
    resetUiLanguage();
    expect(uiLanguage()).toBe('en');
    noteUiLanguage('fr');
    expect(uiLanguage()).toBe('fr');
    noteUiLanguage('de');
    expect(uiLanguage()).toBe('fr');
  });
});

describe('tr', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
  beforeAll(() => {
    fs.mkdirSync(path.join(root, 'demo', 'i18n'), { recursive: true });
    fs.writeFileSync(path.join(root, 'demo', 'i18n', 'messages.fr.json'), JSON.stringify({ 'demo.size': 'Trop lourd ({0} Mo)' }));
    fs.writeFileSync(path.join(root, 'demo', 'i18n', 'messages.en.json'), JSON.stringify({ 'demo.size': 'Too large ({0} MB)' }));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('merges the files of every module and fills the parameters', () => {
    const dictionaries = loadDictionaries(root);
    expect(dictionaries.fr['demo.size']).toBe('Trop lourd ({0} Mo)');
    expect(dictionaries.en['demo.size']).toBe('Too large ({0} MB)');
  });
  it('returns an unknown key as itself', () => {
    clearTranslations();
    expect(tr('nope.missing')).toBe('nope.missing');
  });
});
