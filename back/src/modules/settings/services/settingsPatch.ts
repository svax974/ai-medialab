/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { UnprocessableEntityException } from '@nestjs/common';
import type { PublicSettings, SettingsPatch, StudioSettings } from '../types/settingsTypes';

export const KEEP_ALIVE_MIN = -1;
export const KEEP_ALIVE_MAX = 1440;
const MAX_KEY_LENGTH = 512;

export const DEFAULT_SETTINGS: StudioSettings = {
  keep_alive_minutes: 10,
  previews: true,
  low_memory: true,
  quantize: {},
  variant: {},
  hf_token: '',
  brave_api_key: '',
  chat_voice_id: '',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(message: string): never {
  throw new UnprocessableEntityException(message);
}

function parseMap<T>(name: string, value: unknown, valid: (v: unknown) => v is T, what: string): Record<string, T> {
  if (!isRecord(value)) return fail(`${name} doit être un objet.`);
  for (const [key, item] of Object.entries(value)) if (!valid(item)) fail(`${name}.${key} : ${what} attendu.`);
  return value as Record<string, T>;
}

/**
 * Validates the body of `PUT /api/settings`. Unknown members are ignored and `null` means "absent" (as the legacy API
 * did); a wrong type is a 422. The engine does the model-aware checks (known model, supported quantization).
 */
export function parseSettingsPatch(body: unknown): SettingsPatch {
  if (!isRecord(body)) return fail('Corps JSON attendu.');
  const patch: SettingsPatch = {};
  const { keep_alive_minutes: keep, previews, low_memory: low, hf_token: token, brave_api_key: brave, chat_voice_id: chatVoice, quantize, variant } = body;
  if (keep != null) {
    if (typeof keep !== 'number' || !Number.isInteger(keep) || keep < KEEP_ALIVE_MIN || keep > KEEP_ALIVE_MAX) {
      fail(`keep_alive_minutes : entier entre ${KEEP_ALIVE_MIN} et ${KEEP_ALIVE_MAX} attendu.`);
    }
    patch.keep_alive_minutes = keep as number;
  }
  if (previews != null) patch.previews = typeof previews === 'boolean' ? previews : fail('previews : booléen attendu.');
  if (low != null) patch.low_memory = typeof low === 'boolean' ? low : fail('low_memory : booléen attendu.');
  if (token != null) patch.hf_token = typeof token === 'string' ? token.trim() : fail('hf_token : texte attendu.');
  if (brave != null) patch.brave_api_key = typeof brave === 'string' && brave.length <= MAX_KEY_LENGTH ? brave.trim() : fail(`brave_api_key : texte de ${MAX_KEY_LENGTH} caractères au plus attendu.`);
  if (chatVoice != null) patch.chat_voice_id = typeof chatVoice === 'string' && chatVoice.length <= MAX_KEY_LENGTH ? chatVoice.trim() : fail(`chat_voice_id : texte de ${MAX_KEY_LENGTH} caractères au plus attendu.`);
  if (quantize != null) {
    patch.quantize = parseMap('quantize', quantize, (v): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v)), 'entier ou null');
  }
  if (variant != null) patch.variant = parseMap('variant', variant, (v): v is string => typeof v === 'string', 'texte');
  return patch;
}

/** The stored settings with a patch applied: scalars replace, `quantize` and `variant` are merged per model. */
export function applyPatch(current: StudioSettings, patch: SettingsPatch): StudioSettings {
  return {
    ...current,
    ...patch,
    quantize: { ...current.quantize, ...patch.quantize },
    variant: { ...current.variant, ...patch.variant },
  };
}

export function toPublic(settings: StudioSettings): PublicSettings {
  const { hf_token: token, brave_api_key: brave, ...rest } = settings;
  return { ...rest, has_hf_token: token.length > 0, has_brave_api_key: brave.length > 0 };
}
