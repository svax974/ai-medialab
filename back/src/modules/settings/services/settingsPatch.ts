/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { UnprocessableEntityException } from '@nestjs/common';
import type { PublicSettings, SettingsPatch, StudioSettings } from '../types/settingsTypes';
import { tr } from 'src/modules/i18n';

export const KEEP_ALIVE_MIN = -1;
export const KEEP_ALIVE_MAX = 1440;
export const MEMORY_LIMIT_MAX = 4096;
const MAX_KEY_LENGTH = 512;

export const DEFAULT_SETTINGS: StudioSettings = {
  keep_alive_minutes: 10,
  previews: true,
  low_memory: true,
  memory_limit_gb: 0,
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
  if (!isRecord(value)) return fail(tr('settings.error.object', [name]));
  for (const [key, item] of Object.entries(value)) if (!valid(item)) fail(tr('settings.error.entry', [name, key, what]));
  return value as Record<string, T>;
}

/**
 * Validates the body of `PUT /api/settings`. Unknown members are ignored and `null` means "absent" (as the legacy API
 * did); a wrong type is a 422. The engine does the model-aware checks (known model, supported quantization).
 */
export function parseSettingsPatch(body: unknown): SettingsPatch {
  if (!isRecord(body)) return fail(tr('settings.error.body'));
  const patch: SettingsPatch = {};
  const { keep_alive_minutes: keep, previews, low_memory: low, memory_limit_gb: memoryLimit, hf_token: token, brave_api_key: brave, chat_voice_id: chatVoice, quantize, variant } = body;
  if (keep != null) {
    if (typeof keep !== 'number' || !Number.isInteger(keep) || keep < KEEP_ALIVE_MIN || keep > KEEP_ALIVE_MAX) {
      fail(tr('settings.error.keepAlive', [KEEP_ALIVE_MIN, KEEP_ALIVE_MAX]));
    }
    patch.keep_alive_minutes = keep as number;
  }
  if (previews != null) patch.previews = typeof previews === 'boolean' ? previews : fail(tr('settings.error.boolean', ['previews']));
  if (low != null) patch.low_memory = typeof low === 'boolean' ? low : fail(tr('settings.error.boolean', ['low_memory']));
  if (memoryLimit != null) {
    if (typeof memoryLimit !== 'number' || !Number.isFinite(memoryLimit) || memoryLimit < 0 || memoryLimit > MEMORY_LIMIT_MAX) {
      fail(tr('settings.error.memoryLimit', [MEMORY_LIMIT_MAX]));
    }
    patch.memory_limit_gb = memoryLimit;
  }
  if (token != null) patch.hf_token = typeof token === 'string' ? token.trim() : fail(tr('settings.error.text', ['hf_token']));
  if (brave != null) patch.brave_api_key = typeof brave === 'string' && brave.length <= MAX_KEY_LENGTH ? brave.trim() : fail(tr('settings.error.textMax', ['brave_api_key', MAX_KEY_LENGTH]));
  if (chatVoice != null) patch.chat_voice_id = typeof chatVoice === 'string' && chatVoice.length <= MAX_KEY_LENGTH ? chatVoice.trim() : fail(tr('settings.error.textMax', ['chat_voice_id', MAX_KEY_LENGTH]));
  if (quantize != null) {
    patch.quantize = parseMap('quantize', quantize, (v): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v)), tr('settings.what.integerOrNull'));
  }
  if (variant != null) patch.variant = parseMap('variant', variant, (v): v is string => typeof v === 'string', tr('settings.what.text'));
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
