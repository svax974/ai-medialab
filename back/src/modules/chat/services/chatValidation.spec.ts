/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  parseConfirmBody, parseCreationModels, parseEditBody, parseEnhanceBody, parseExportFormat, parseId, parseLeafBody, parseParams, parseRegenerateBody, parseSearchQuery, parseSendBody, parseSettingsPatch,
} from './chatValidation';

const name = 'chat_0123456789abcdef.png';

describe('parseSendBody', () => {
  it('reads a message', () => {
    expect(parseSendBody({ content: 'Bonjour' })).toEqual({ content: 'Bonjour', attachments: [], parentId: undefined, modelId: undefined, creationModels: undefined });
    expect(parseSendBody({ content: 'x', parent_id: null, model_id: 'llm-a', attachments: [{ name }, { name }] })).toEqual({
      content: 'x', attachments: [name], parentId: null, modelId: 'llm-a', creationModels: undefined,
    });
  });

  it('needs text or an attachment', () => {
    expect(() => parseSendBody({ content: '   ' })).toThrow(UnprocessableEntityException);
    expect(() => parseSendBody({})).toThrow(UnprocessableEntityException);
    expect(parseSendBody({ content: '', attachments: [{ name }] }).attachments).toEqual([name]);
  });

  it.each([
    [null], ['text'], [[]], [{ content: 5 }], [{ content: 'x'.repeat(200_001) }], [{ content: 'x', parent_id: 5 }], [{ content: 'x', parent_id: '../etc' }],
    [{ content: 'x', model_id: '' }], [{ content: 'x', model_id: 'm'.repeat(201) }], [{ content: 'x', attachments: 'nope' }],
    [{ content: 'x', attachments: [{ name: '../../etc/passwd' }] }], [{ content: 'x', attachments: [{ name: 'chat_0123456789abcdef.png/../x' }] }],
    [{ content: 'x', attachments: [{ name: 'evil.png' }] }], [{ content: 'x', attachments: [{}] }],
    [{ content: 'x', attachments: Array.from({ length: 9 }, (_, i) => ({ name: `chat_000000000000000${i}.png` })) }],
  ])('rejects the invalid body %j', (body) => {
    expect(() => parseSendBody(body)).toThrow();
  });
});

describe('other bodies', () => {
  it('regenerate: an optional model', () => {
    expect(parseRegenerateBody(undefined)).toEqual({ modelId: undefined });
    expect(parseRegenerateBody({ model_id: 'llm-b' })).toEqual({ modelId: 'llm-b', forceMemory: false });
    expect(parseRegenerateBody({ force_memory: true }).forceMemory).toBe(true);
    expect(() => parseRegenerateBody({ model_id: 3 })).toThrow(UnprocessableEntityException);
  });

  it('edit: attachments omitted keep the original ones', () => {
    expect(parseEditBody({ content: 'v2' })).toEqual({ content: 'v2', attachments: undefined });
    expect(parseEditBody({ content: 'v2', attachments: [] }).attachments).toEqual([]);
    expect(() => parseEditBody({ content: ' ', attachments: [] })).toThrow(UnprocessableEntityException);
    expect(() => parseEditBody({ content: '' })).not.toThrow(); // the original has attachments or text: the route decides
  });

  it('leaf', () => {
    expect(parseLeafBody({ message_id: 'abc123' })).toBe('abc123');
    expect(() => parseLeafBody({ message_id: '../x' })).toThrow(BadRequestException);
    expect(() => parseLeafBody(null)).toThrow(UnprocessableEntityException);
  });

  it('enhance', () => {
    expect(parseEnhanceBody({ kind: 'image', prompt: 'un chat' })).toEqual({ kind: 'image', prompt: 'un chat', modelId: undefined });
    for (const body of [{ kind: 'text', prompt: 'x' }, { kind: 'image', prompt: ' ' }, { kind: 'video', prompt: 'x'.repeat(8001) }, { kind: 'audio' }, null]) {
      expect(() => parseEnhanceBody(body)).toThrow(UnprocessableEntityException);
    }
  });

  it('ids, search query and export format (400)', () => {
    expect(parseId('0189abc-DEF_1', 'id')).toBe('0189abc-DEF_1');
    for (const bad of ['', 'a/b', 'a b', 'x'.repeat(65), 5, undefined, '..']) expect(() => parseId(bad, 'id')).toThrow(BadRequestException);
    expect(parseSearchQuery('  chat ')).toBe('chat');
    for (const bad of [undefined, '', '   ', 'x'.repeat(201)]) expect(() => parseSearchQuery(bad)).toThrow(BadRequestException);
    expect(parseExportFormat('md')).toBe('md');
    expect(() => parseExportFormat('pdf')).toThrow(BadRequestException);
    expect(() => parseExportFormat(undefined)).toThrow(BadRequestException);
  });
});

describe('settings', () => {
  it('accepts any subset', () => {
    expect(parseSettingsPatch({})).toEqual({});
    expect(
      parseSettingsPatch({
        model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.7, top_k: 40, seed: 7, stop: ['\n\n'] }, context_size: 8192, reasoning: 'low', tools: { web: true },
      }),
    ).toEqual({ model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.7, top_k: 40, seed: 7, stop: ['\n\n'] }, context_size: 8192, reasoning: 'low', tools: { web: true } });
    expect(parseSettingsPatch({ model_id: null, context_size: null })).toEqual({ model_id: null, context_size: null });
  });

  it('bounds every sampling parameter like the engine does', () => {
    expect(parseParams({ temperature: 2, top_p: 1, min_p: 0, repeat_penalty: 2, presence_penalty: -2, frequency_penalty: 2, max_tokens: 262144, top_k: 1000 })).toBeTruthy();
    for (const bad of [
      { temperature: 2.1 }, { temperature: -0.1 }, { top_p: 1.5 }, { top_k: 1.5 }, { top_k: 1001 }, { max_tokens: 0 }, { max_tokens: 262145 }, { seed: -1 }, { seed: 4294967296 },
      { presence_penalty: 3 }, { stop: 'x' }, { stop: Array(9).fill('a') }, { stop: [''] }, { stop: ['x'.repeat(65)] }, { temperature: '0.5' }, { temperature: NaN }, { unknown: 1 },
    ]) {
      expect(() => parseParams(bad)).toThrow(UnprocessableEntityException);
    }
    expect(parseParams({ temperature: null, seed: null })).toEqual({}); // null removes
  });

  it.each([
    [{ model_id: '' }], [{ model_id: 4 }], [{ system_prompt: 'x'.repeat(20_001) }], [{ system_prompt: 3 }], [{ params: [] }], [{ context_size: 100 }], [{ context_size: 2_000_000 }],
    [{ context_size: 1000.5 }], [{ reasoning: 'max' }], [{ tools: { web: 'yes' } }], [{ tools: { creation: 1 } }], [{ tools: { other: true } }], [{ tools: {} }], [{ tools: null }], [null], ['x'],
  ])('rejects %j', (body) => {
    expect(() => parseSettingsPatch(body)).toThrow(UnprocessableEntityException);
  });

  it('never lets leaf_id through', () => {
    expect(parseSettingsPatch({ leaf_id: 'abc', reasoning: 'off' })).toEqual({ reasoning: 'off' });
  });
});

describe('creation_models and the choice of a generation', () => {
  it('reads the model of each studio, nothing else', () => {
    expect(parseCreationModels(undefined)).toBeUndefined();
    expect(parseCreationModels(null)).toBeUndefined();
    expect(parseCreationModels({ image: 'flux', audio: 'kokoro', junk: 'x' })).toEqual({ image: 'flux', audio: 'kokoro' });
    expect(parseSendBody({ content: 'x', creation_models: { video: 'wan' } }).creationModels).toEqual({ video: 'wan' });
    expect(parseRegenerateBody({ creation_models: { image: 'flux' } }).creationModels).toEqual({ image: 'flux' });
    expect(parseEditBody({ content: 'x', creation_models: { image: 'flux' } }).creationModels).toEqual({ image: 'flux' });
  });

  it.each([['x'], [[]], [{ image: '' }], [{ image: 5 }], [{ video: 'm'.repeat(201) }]])('rejects creation_models %j (422)', (value) => {
    expect(() => parseCreationModels(value)).toThrow(UnprocessableEntityException);
  });

  it('settings accept the creation switch alone or with the web one', () => {
    expect(parseSettingsPatch({ tools: { creation: false } })).toEqual({ tools: { creation: false } });
    expect(parseSettingsPatch({ tools: { web: true, creation: true } })).toEqual({ tools: { web: true, creation: true } });
  });

  it('the confirmation takes a duration or a voice', () => {
    expect(parseConfirmBody({ seconds: 4 })).toEqual({ seconds: 4 });
    expect(parseConfirmBody({ voice_id: 'abc123' })).toEqual({ voiceId: 'abc123' });
    expect(() => parseConfirmBody({ seconds: 'x' })).toThrow(UnprocessableEntityException);
    expect(() => parseConfirmBody({ seconds: 1000 })).toThrow(UnprocessableEntityException);
    expect(() => parseConfirmBody({ voice_id: '../x' })).toThrow(UnprocessableEntityException);
    expect(() => parseConfirmBody(null)).toThrow(UnprocessableEntityException);
  });
});
