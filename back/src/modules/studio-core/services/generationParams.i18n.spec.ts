/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { resetUiLanguage } from 'src/modules/i18n';
import { isDefaultChatTitle, isDefaultConversationTitle } from '../types/studioTypes';
import { parseCreateMessage } from './generationParams';

describe('studio-core messages follow the interface language', () => {
  afterEach(() => resetUiLanguage('fr'));

  it('validation errors in French by default, in English on demand', () => {
    expect(() => parseCreateMessage(null)).toThrow('Corps JSON attendu.');
    resetUiLanguage('en');
    expect(() => parseCreateMessage(null)).toThrow('JSON body expected.');
    expect(() => parseCreateMessage({ prompt: '' })).toThrow('prompt: text of 1 to 8000 characters expected.');
  });

  it('recognises a default title written in either language', () => {
    expect(isDefaultConversationTitle('Nouvelle création')).toBe(true);
    expect(isDefaultConversationTitle('New creation')).toBe(true);
    expect(isDefaultChatTitle('New conversation')).toBe(true);
    expect(isDefaultChatTitle('Autre')).toBe(false);
  });
});
