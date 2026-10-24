/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { DEFAULT_SETTINGS, applyPatch, parseSettingsPatch, toPublic } from './settingsPatch';

describe('parseSettingsPatch', () => {
  it('keeps the known members and drops unknown ones and nulls', () => {
    expect(parseSettingsPatch({ keep_alive_minutes: 30, previews: false, extra: 1, low_memory: null })).toEqual({
      keep_alive_minutes: 30,
      previews: false,
    });
  });

  it('trims the token and accepts an empty one (removal)', () => {
    expect(parseSettingsPatch({ hf_token: '  hf_x ' })).toEqual({ hf_token: 'hf_x' });
    expect(parseSettingsPatch({ hf_token: '' })).toEqual({ hf_token: '' });
    expect(parseSettingsPatch({ brave_api_key: ' BSA ' })).toEqual({ brave_api_key: 'BSA' });
    expect(() => parseSettingsPatch({ brave_api_key: 'x'.repeat(513) })).toThrow();
    expect(parseSettingsPatch({ chat_voice_id: ' v1 ' })).toEqual({ chat_voice_id: 'v1' });
    expect(parseSettingsPatch({ chat_voice_id: '' })).toEqual({ chat_voice_id: '' });
    expect(() => parseSettingsPatch({ chat_voice_id: 4 })).toThrow();
  });

  it('accepts a memory ceiling from 0 (automatic) up and refuses a negative or absurd one', () => {
    expect(parseSettingsPatch({ memory_limit_gb: 0 })).toEqual({ memory_limit_gb: 0 });
    expect(parseSettingsPatch({ memory_limit_gb: 24.5 })).toEqual({ memory_limit_gb: 24.5 });
    expect(() => parseSettingsPatch({ memory_limit_gb: -1 })).toThrow(UnprocessableEntityException);
    expect(() => parseSettingsPatch({ memory_limit_gb: 99999 })).toThrow(UnprocessableEntityException);
    expect(() => parseSettingsPatch({ memory_limit_gb: '8' })).toThrow(UnprocessableEntityException);
  });

  it('accepts the model maps', () => {
    expect(parseSettingsPatch({ quantize: { m: 4, n: null }, variant: { m: 'Q4_K_M' } })).toEqual({
      quantize: { m: 4, n: null },
      variant: { m: 'Q4_K_M' },
    });
  });

  it.each([
    [{ keep_alive_minutes: 'x' }],
    [{ keep_alive_minutes: 1.5 }],
    [{ keep_alive_minutes: -2 }],
    [{ keep_alive_minutes: 5000 }],
    [{ previews: 'yes' }],
    [{ low_memory: 1 }],
    [{ hf_token: 5 }],
    [{ quantize: { m: '4' } }],
    [{ quantize: [] }],
    [{ variant: { m: 4 } }],
    ['text'],
    [[]],
  ])('rejects %j with a 422', (body) => {
    expect(() => parseSettingsPatch(body)).toThrow(UnprocessableEntityException);
  });
});

describe('applyPatch / toPublic', () => {
  it('replaces scalars and merges the model maps', () => {
    const current = { ...DEFAULT_SETTINGS, quantize: { a: 4 }, variant: { a: 'q4' }, hf_token: 'tok' };
    const next = applyPatch(current, { previews: false, quantize: { b: null }, variant: { a: 'q8' } });
    expect(next).toMatchObject({ previews: false, quantize: { a: 4, b: null }, variant: { a: 'q8' }, hf_token: 'tok' });
    expect(current.quantize).toEqual({ a: 4 });
  });

  it('never exposes the token', () => {
    const pub = toPublic({ ...DEFAULT_SETTINGS, hf_token: 'secret' });
    expect(pub).not.toHaveProperty('hf_token');
    expect(pub.has_hf_token).toBe(true);
    expect(toPublic(DEFAULT_SETTINGS).has_hf_token).toBe(false);
    expect(Object.keys(pub).sort()).toEqual(['chat_voice_id', 'has_brave_api_key', 'has_hf_token', 'keep_alive_minutes', 'low_memory', 'memory_limit_gb', 'previews', 'quantize', 'variant']);
  });
});
