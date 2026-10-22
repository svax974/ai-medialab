/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { SettingsService } from '../services/SettingsService';
import { parseSettingsPatch } from '../services/settingsPatch';
import type { PublicSettings } from '../types/settingsTypes';

/** `/api/settings`: same URLs and shape as the engine's legacy route (the token is never returned). Admin only. */
@ApiExcludeController()
@Controller('api/settings')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<PublicSettings> {
    return this.settings.getPublic();
  }

  @Put()
  put(@Body() body: unknown): Promise<PublicSettings> {
    return this.settings.update(parseSettingsPatch(body));
  }
}
