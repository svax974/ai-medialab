/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { UnprocessableEntityException } from '@nestjs/common';
import { defaultConversationTitle } from '../types/studioTypes';
import type { CreateGenerationInput, RetryInput } from '../types/jobTypes';

export const MAX_PROMPT_LENGTH = 8000;
export const MAX_COUNT = 4;
const TITLE_LENGTH = 60;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(message: string): never {
  throw new UnprocessableEntityException(message);
}

/** Validates the body of `POST /api/messages` (same limits as the legacy route; 422 otherwise). */
export function parseCreateMessage(body: unknown): CreateGenerationInput {
  if (!isRecord(body)) return fail(tr('studioCore.error.jsonBodyExpected'));
  const { conversation_id: conversationId, prompt, model_id: modelId, params, reference_ids: refs, count } = body;
  if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > MAX_PROMPT_LENGTH) {
    fail(tr('studioCore.error.promptLength', [MAX_PROMPT_LENGTH]));
  }
  if (typeof modelId !== 'string' || !modelId) fail(tr('studioCore.error.textExpected', ['model_id']));
  if (conversationId != null && typeof conversationId !== 'string') fail(tr('studioCore.error.textExpected', ['conversation_id']));
  if (params != null && !isRecord(params)) fail(tr('studioCore.error.objectExpected', ['params']));
  if (refs != null && (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string'))) fail(tr('studioCore.error.referenceIdsList'));
  if (count != null && (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT)) {
    fail(tr('studioCore.error.countRange', [MAX_COUNT]));
  }
  return {
    conversationId: (conversationId as string | null | undefined) ?? null,
    prompt: prompt as string,
    modelId: modelId as string,
    params: (params as Record<string, unknown> | null | undefined) ?? {},
    referenceIds: [...new Set((refs as string[] | null | undefined) ?? [])],
    count: (count as number | null | undefined) ?? 1,
  };
}

/** Validates the body of `POST /api/messages/:id/retry`. */
export function parseRetry(body: unknown): RetryInput {
  if (body == null) return { keepSeed: false, forceMemory: false };
  if (!isRecord(body)) return fail(tr('studioCore.error.jsonBodyExpected'));
  const { model_id: modelId, params, keep_seed: keepSeed, force_memory: forceMemory } = body;
  if (modelId != null && typeof modelId !== 'string') fail(tr('studioCore.error.textExpected', ['model_id']));
  if (params != null && !isRecord(params)) fail(tr('studioCore.error.objectExpected', ['params']));
  if (keepSeed != null && typeof keepSeed !== 'boolean') fail(tr('studioCore.error.booleanExpected', ['keep_seed']));
  if (forceMemory != null && typeof forceMemory !== 'boolean') fail(tr('studioCore.error.booleanExpected', ['force_memory']));
  return {
    modelId: (modelId as string | null | undefined) || undefined,
    params: (params as Record<string, unknown> | null | undefined) ?? undefined,
    keepSeed: Boolean(keepSeed),
    forceMemory: Boolean(forceMemory),
  };
}

/** Same title as the legacy server: whitespace collapsed, 60 characters at most, cut at a word with an ellipsis. */
export function titleFromPrompt(prompt: string): string {
  const text = prompt.split(/\s+/).filter(Boolean).join(' ');
  if (text.length <= TITLE_LENGTH) return text || defaultConversationTitle();
  const cut = text.slice(0, TITLE_LENGTH - 3);
  const space = cut.lastIndexOf(' ');
  return `${space >= 0 ? cut.slice(0, space) : cut}…`;
}

/** One seed per result: `base + i` when the user fixed a seed, otherwise random (31 bits, the engine's range). */
export function seedsFor(params: Record<string, unknown>, count: number, random: () => number = Math.random): number[] {
  const seed = params.seed;
  if (seed !== undefined && seed !== null && String(seed).trim() !== '') {
    const base = Number(seed);
    if (!Number.isFinite(base)) fail(tr('studioCore.error.seedInteger'));
    return Array.from({ length: count }, (_, i) => Math.trunc(base) + i);
  }
  return Array.from({ length: count }, () => Math.floor(random() * 2 ** 31));
}
