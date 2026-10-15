/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { settingsConfigSchema } from './configSchema';
import { LEGACY_SETTING_KEYS, mapLegacySettings } from './legacySettings';

describe('studio settings', () => {
  it('declares every legacy setting once, with the secret token encrypted by the module config', () => {
    const byKey = new Map(settingsConfigSchema.fields.map((f) => [f.key, f]));
    // The Brave Search key is newer than the legacy database: it is the only declared setting it never carried.
    expect([...byKey.keys()].filter((key) => key !== 'studio_braveApiKey').sort()).toEqual(Object.values(LEGACY_SETTING_KEYS).sort());
    expect(byKey.get('studio_hfToken')?.type).toBe('secret');
    expect(byKey.get('studio_braveApiKey')?.type).toBe('secret');
    expect(byKey.get('studio_keepAliveMinutes')).toMatchObject({ type: 'number', defaultValue: 10 });
    expect(byKey.get('studio_previews')?.defaultValue).toBe(true);
    expect(byKey.get('studio_lowMemory')?.defaultValue).toBe(true);
    expect(byKey.get('studio_quantize')).toMatchObject({ type: 'json', hidden: true, defaultValue: {} });
    expect(byKey.get('studio_variant')).toMatchObject({ type: 'json', hidden: true, defaultValue: {} });
  });

  it('maps the legacy keys to module-config keys', () => {
    expect(
      mapLegacySettings({
        keep_alive_minutes: -1, previews: false, low_memory: true, quantize: { a: 4 }, variant: { a: 'q4' }, hf_token: 'hf_x',
      }),
    ).toEqual({
      studio_keepAliveMinutes: -1, studio_previews: false, studio_lowMemory: true,
      studio_quantize: { a: 4 }, studio_variant: { a: 'q4' }, studio_hfToken: 'hf_x',
    });
  });

  it('drops unknown keys, nulls, empty tokens and values of the wrong type', () => {
    expect(
      mapLegacySettings({
        other: 1, keep_alive_minutes: '10', previews: 'yes', low_memory: null, quantize: [1], variant: 'q4', hf_token: '',
      }),
    ).toEqual({});
  });
});
