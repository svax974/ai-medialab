/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { resetUiLanguage, tr } from 'src/modules/i18n';

describe('private messages follow the interface language', () => {
  afterEach(() => resetUiLanguage('fr'));

  it('translates the session error', () => {
    expect(tr('private.error.noSession')).toBe("Aucune session privée n'est ouverte.");
    resetUiLanguage('en');
    expect(tr('private.error.noSession')).toBe('No private session is open.');
  });
});
