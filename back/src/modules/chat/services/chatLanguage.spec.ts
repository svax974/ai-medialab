/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { resetUiLanguage } from 'src/modules/i18n';
import type { ConversationDto } from 'src/modules/studio-core';
import { acceptLanguage } from '../tools/acceptLanguage';
import { assertPublicUrl } from '../tools/ssrfGuard';
import { toMarkdown } from './chatExport';
import { parseEditBody } from './chatValidation';
import type { ChatSettings } from '../types/chatTypes';

describe('chat messages follow the interface language', () => {
  afterEach(() => resetUiLanguage('fr'));

  it('orders Accept-Language by the interface language', () => {
    expect(acceptLanguage()).toBe('fr,en;q=0.8');
    resetUiLanguage('en');
    expect(acceptLanguage()).toBe('en,fr;q=0.8');
  });

  it('translates validation errors', () => {
    expect(() => parseEditBody(null)).toThrow('Corps JSON attendu.');
    resetUiLanguage('en');
    expect(() => parseEditBody(null)).toThrow(UnprocessableEntityException);
    expect(() => parseEditBody(null)).toThrow('JSON body expected.');
  });

  it('translates the SSRF refusals the model relays to the user', () => {
    resetUiLanguage('en');
    expect(() => assertPublicUrl('http://localhost/')).toThrow('Local host name refused.');
  });

  it('writes the Markdown export labels in English', () => {
    resetUiLanguage('en');
    const conversation = { id: 'c', title: 'T', mode: 'chat' } as ConversationDto;
    const settings = { system_prompt: 'Be brief.' } as ChatSettings;
    const md = toMarkdown(conversation, settings, []);
    expect(md).toContain('> **System instruction** : Be brief.');
  });
});
