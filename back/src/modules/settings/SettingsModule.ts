/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { SettingsController } from './controllers/SettingsController';
import { SettingsConfigRegistration } from './services/SettingsConfigRegistration';
import { SettingsEngineSync } from './services/SettingsEngineSync';
import { SettingsService } from './services/SettingsService';

/** Studio settings: module config schema, `/api/settings`, and the hand-over to the engine. See README.md. */
@Module({
  imports: [CommonModule],
  controllers: [SettingsController],
  providers: [SettingsConfigRegistration, SettingsService, SettingsEngineSync],
  exports: [SettingsService],
})
export class SettingsModule {}
