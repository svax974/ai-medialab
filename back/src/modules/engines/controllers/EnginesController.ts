/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Controller, Delete, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { EnginesService } from '../services/EnginesService';
import type { EngineInstallState, PackInstallState } from '../types/enginesTypes';

/** `/api/engines/*`: same URLs and shapes as the engine's legacy routes. Admin only. */
@ApiExcludeController()
@Controller('api/engines')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class EnginesController {
  constructor(private readonly engines: EnginesService) {}

  @Post('pack/:packId/install')
  @HttpCode(200)
  installPack(@Param('packId') packId: string): Promise<PackInstallState> {
    return this.engines.installPack(packId);
  }

  /** Declared before `pack/:packId` so that `install` is never read as a pack id. */
  @Delete('pack/install')
  cancelPackInstall(): Promise<{ ok: true }> {
    return this.engines.cancelPackInstall();
  }

  @Delete('pack/:packId')
  uninstallPack(@Param('packId') packId: string): Promise<{ ok: true }> {
    return this.engines.uninstallPack(packId);
  }

  @Post('sdcpp/install')
  @HttpCode(200)
  installSdcpp(): Promise<EngineInstallState> {
    return this.engines.installSdcpp();
  }

  @Delete('sdcpp/install')
  cancelSdcppInstall(): Promise<{ ok: true }> {
    return this.engines.cancelSdcppInstall();
  }
}
