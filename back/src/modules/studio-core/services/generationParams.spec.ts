/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { parseCreateMessage, parseRetry, seedsFor, titleFromPrompt } from './generationParams';

describe('parseCreateMessage', () => {
  it('applies the legacy defaults and de-duplicates the references', () => {
    expect(parseCreateMessage({ prompt: 'chat', model_id: 'm', reference_ids: ['a', 'b', 'a'] })).toEqual({
      conversationId: null, prompt: 'chat', modelId: 'm', params: {}, referenceIds: ['a', 'b'], count: 1,
    });
    expect(parseCreateMessage({ prompt: 'x', model_id: 'm', conversation_id: 'c', count: 4, params: { steps: 3 } })).toMatchObject({
      conversationId: 'c', count: 4, params: { steps: 3 },
    });
  });

  it.each([
    [null], [[]], [{ model_id: 'm' }], [{ prompt: '', model_id: 'm' }], [{ prompt: 'x'.repeat(8001), model_id: 'm' }],
    [{ prompt: 'x' }], [{ prompt: 'x', model_id: 'm', count: 0 }], [{ prompt: 'x', model_id: 'm', count: 5 }],
    [{ prompt: 'x', model_id: 'm', count: 1.5 }], [{ prompt: 'x', model_id: 'm', params: [] }],
    [{ prompt: 'x', model_id: 'm', reference_ids: 'a' }], [{ prompt: 'x', model_id: 'm', reference_ids: [1] }],
    [{ prompt: 'x', model_id: 'm', conversation_id: 3 }],
  ])('refuses %j with a 422', (body) => {
    expect(() => parseCreateMessage(body)).toThrow(UnprocessableEntityException);
  });
});

describe('parseRetry', () => {
  it('accepts an empty body and the three options', () => {
    expect(parseRetry(undefined)).toEqual({ keepSeed: false, forceMemory: false });
    expect(parseRetry({ model_id: 'm2', params: { steps: 5 }, keep_seed: true })).toEqual({ modelId: 'm2', params: { steps: 5 }, keepSeed: true, forceMemory: false });
    expect(parseRetry({ force_memory: true }).forceMemory).toBe(true);
  });

  it('refuses wrong types', () => {
    expect(() => parseRetry({ keep_seed: 'yes' })).toThrow(UnprocessableEntityException);
    expect(() => parseRetry({ params: 3 })).toThrow(UnprocessableEntityException);
    expect(() => parseRetry('x')).toThrow(UnprocessableEntityException);
  });
});

describe('titleFromPrompt', () => {
  it('collapses whitespace and keeps short prompts', () => {
    expect(titleFromPrompt('  un   chat\n roux ')).toBe('un chat roux');
  });

  it('cuts at a word with an ellipsis, 60 characters at most (same as the legacy server)', () => {
    const title = titleFromPrompt('un très long prompt '.repeat(10));
    expect(title.length).toBeLessThanOrEqual(58);
    expect(title).toBe('un très long prompt un très long prompt un très long…');
  });

  it('cuts a single long word at 57 characters', () => {
    expect(titleFromPrompt('x'.repeat(100))).toBe(`${'x'.repeat(57)}…`);
  });
});

describe('seedsFor', () => {
  it('counts up from a fixed seed (number or numeric text)', () => {
    expect(seedsFor({ seed: 10 }, 3)).toEqual([10, 11, 12]);
    expect(seedsFor({ seed: ' 5 ' }, 2)).toEqual([5, 6]);
  });

  it('draws one random 31-bit seed per result otherwise', () => {
    const seeds = seedsFor({ seed: '' }, 3, () => 0.5);
    expect(seeds).toEqual([2 ** 30, 2 ** 30, 2 ** 30]);
    expect(seedsFor({ seed: null }, 2)).toHaveLength(2);
    const [seed] = seedsFor({}, 1);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 31);
  });

  it('refuses a seed that is not a number', () => {
    expect(() => seedsFor({ seed: 'abc' }, 1)).toThrow(UnprocessableEntityException);
  });
});
