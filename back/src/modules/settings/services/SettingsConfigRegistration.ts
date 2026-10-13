/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleConfigService } from 'src/modules_shared/common/CommonModule';
import { settingsConfigSchema } from '../configSchema';

/** Registers the studio settings schema (admin UI, defaults seeding, encrypted `hf_token`). */
@Injectable()
export class SettingsConfigRegistration implements OnApplicationBootstrap {
  constructor(private readonly moduleConfigService: ModuleConfigService) {}

  onApplicationBootstrap(): void {
    this.moduleConfigService.register(settingsConfigSchema);
  }
}
