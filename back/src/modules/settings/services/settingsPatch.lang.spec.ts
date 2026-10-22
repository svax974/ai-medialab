/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { resetUiLanguage } from 'src/modules/i18n';
import { parseSettingsPatch } from './settingsPatch';

describe('parseSettingsPatch, language of the errors', () => {
  afterEach(() => resetUiLanguage('fr'));

  it('words a patch error in the language of the interface', () => {
    resetUiLanguage('en');
    expect(() => parseSettingsPatch({ previews: 'x' })).toThrow('previews: a boolean is expected.');
    expect(() => parseSettingsPatch({ quantize: { a: 'x' } })).toThrow('quantize.a: an integer or null expected.');
    resetUiLanguage('fr');
    expect(() => parseSettingsPatch({ previews: 'x' })).toThrow('previews : booléen attendu.');
  });
});
