/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { resetUiLanguage } from 'src/modules/i18n';
import { parseAdviseBody } from './AdviseBody';

describe('parseAdviseBody, language of the errors', () => {
  afterEach(() => resetUiLanguage('fr'));

  it('words a validation error in the language of the interface', () => {
    resetUiLanguage('en');
    expect(() => parseAdviseBody({ kind: 'x', id: 'a' })).toThrow('"kind" must be one of: engine, model');
    resetUiLanguage('fr');
    expect(() => parseAdviseBody({ kind: 'x', id: 'a' })).toThrow('« kind » doit valoir l\'une de ces valeurs : engine, model');
  });
});
