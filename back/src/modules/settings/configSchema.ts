/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { ModuleConfigSchema } from 'src/modules_shared/common/types/ModuleConfigSchema';

export const SETTINGS_MODULE_ID = 'studio';

/**
 * Settings of the studio (the `settings` table of the legacy database, `engine/app/jobs.py` `DEFAULT_SETTINGS`).
 * Keys follow the `{moduleId}_{configKey}` convention; labels are locale keys (`src/locales/custom.*.json`).
 * `quantize` and `variant` are maps `model_id -> value` edited by the model dialog (H4.2), hence `hidden`.
 */
export const settingsConfigSchema: ModuleConfigSchema = {
  moduleId: SETTINGS_MODULE_ID,
  moduleName: 'Studio',
  description: 'custom.settings.description',
  icon: 'settings',
  fields: [
    {
      key: 'studio_keepAliveMinutes',
      label: 'custom.settings.keepAliveMinutes',
      description: 'custom.settings.keepAliveMinutes.description',
      type: 'number',
      defaultValue: 10,
      group: 'performance',
      validation: { min: -1, max: 1440 },
    },
    {
      key: 'studio_previews',
      label: 'custom.settings.previews',
      description: 'custom.settings.previews.description',
      type: 'boolean',
      defaultValue: true,
      group: 'performance',
    },
    {
      key: 'studio_lowMemory',
      label: 'custom.settings.lowMemory',
      description: 'custom.settings.lowMemory.description',
      type: 'boolean',
      defaultValue: true,
      group: 'performance',
    },
    {
      key: 'studio_quantize',
      label: 'custom.settings.quantize',
      type: 'json',
      defaultValue: {},
      group: 'performance',
      hidden: true,
    },
    {
      key: 'studio_variant',
      label: 'custom.settings.variant',
      type: 'json',
      defaultValue: {},
      group: 'performance',
      hidden: true,
    },
    {
      key: 'studio_hfToken',
      label: 'custom.settings.hfToken',
      description: 'custom.settings.hfToken.description',
      type: 'secret',
      group: 'sources',
    },
    {
      key: 'studio_braveApiKey',
      label: 'custom.settings.braveApiKey',
      description: 'custom.settings.braveApiKey.description',
      type: 'secret',
      group: 'sources',
    },
  ],
};
