/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { MessageDto } from 'src/modules/studio-core';
import type { StoredGeneration } from '../types/chatTypes';
import { toChatGeneration, toChatSettings } from './chatMapper';

const stored: StoredGeneration = { id: 'g1', kind: 'image', model_id: 'flux', message_id: 'job1', prompt: 'un chat', params: {} };
const asset = { id: 'a1', url: '/media/outputs/a1.png' };
const job = (over: Partial<MessageDto> = {}) => ({ id: 'job1', status: 'done', error: null, outputs: [asset], ...over }) as unknown as MessageDto;

describe('toChatGeneration', () => {
  it('takes the state and the files from the studio message', () => {
    expect(toChatGeneration(stored, 'conv', new Map([['job1', job()]]))).toEqual({ ...stored, state: 'done', error: null, assets: [asset], conversation_id: 'conv' });
    expect(toChatGeneration(stored, 'conv', new Map([['job1', job({ status: 'error', error: 'Mémoire insuffisante', outputs: [] })]]))).toMatchObject({ state: 'error', error: 'Mémoire insuffisante', assets: [] });
  });

  it('is pending while it waits for the user, whatever the studio says', () => {
    expect(toChatGeneration({ ...stored, message_id: null, pending: 'duration' }, 'conv', new Map())).toMatchObject({ state: 'pending', pending: 'duration', assets: [] });
  });

  it('counts a generation whose studio message is gone as cancelled', () => {
    expect(toChatGeneration(stored, 'conv', new Map())).toMatchObject({ state: 'cancelled', assets: [] });
  });
});

describe('toChatSettings', () => {
  it('has the creation tools on unless the row switched them off (rows written before them have no flag)', () => {
    const row = (tools: { web: boolean; creation?: boolean }) => toChatSettings({ conversationId: 'c', modelId: null, systemPrompt: '', params: {}, contextSize: null, reasoning: 'auto', tools, leafId: null });
    expect(row({ web: true }).tools).toEqual({ web: true, creation: true });
    expect(row({ web: false, creation: false }).tools).toEqual({ web: false, creation: false });
    expect(toChatSettings(null).tools).toEqual({ web: false, creation: true });
  });
});
