/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { SettingsConfigRegistration } from './services/SettingsConfigRegistration';

/** Declares the studio settings (module config). Routes, the settings panel and the hand-over to the engine: H4.1. */
@Module({
  imports: [CommonModule],
  providers: [SettingsConfigRegistration],
})
export class SettingsModule {}
