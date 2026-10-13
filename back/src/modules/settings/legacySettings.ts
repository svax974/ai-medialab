/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { SETTINGS_MODULE_ID } from './configSchema';

/** Keys of the legacy `settings` table (`engine/app/db.py`) and the module-config key each one becomes. */
export const LEGACY_SETTING_KEYS: Record<string, string> = {
  keep_alive_minutes: 'studio_keepAliveMinutes',
  previews: 'studio_previews',
  low_memory: 'studio_lowMemory',
  quantize: 'studio_quantize',
  variant: 'studio_variant',
  hf_token: 'studio_hfToken',
};

/**
 * Converts the decoded legacy settings (`{ key: JSON value }`) to module-config values. Unknown keys are dropped;
 * values of the wrong type are dropped too (the default then applies) rather than stored as garbage.
 */
export function mapLegacySettings(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [legacyKey, configKey] of Object.entries(LEGACY_SETTING_KEYS)) {
    const value = legacy[legacyKey];
    if (value === undefined || value === null) continue;
    if (isValidSetting(legacyKey, value)) out[configKey] = value;
  }
  return out;
}

function isValidSetting(legacyKey: string, value: unknown): boolean {
  switch (legacyKey) {
    case 'keep_alive_minutes':
      return typeof value === 'number' && Number.isFinite(value);
    case 'previews':
    case 'low_memory':
      return typeof value === 'boolean';
    case 'hf_token':
      return typeof value === 'string' && value.length > 0;
    default: // quantize, variant: a plain object
      return typeof value === 'object' && !Array.isArray(value);
  }
}

export { SETTINGS_MODULE_ID };
