/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { EnginesService } from '../services/EnginesService';
import type { ComponentInfo, EngineInstallState, PackInstallState, SetupPlan, SetupState } from '../types/enginesTypes';

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

  @Post('llamacpp/install')
  @HttpCode(200)
  installLlamacpp(): Promise<EngineInstallState> {
    return this.engines.installLlamacpp();
  }

  /** Declared before `llamacpp` (uninstall) so that `install` is never read as part of another route. */
  @Delete('llamacpp/install')
  cancelLlamacppInstall(): Promise<{ ok: true }> {
    return this.engines.cancelLlamacppInstall();
  }

  @Delete('llamacpp')
  uninstallLlamacpp(): Promise<{ ok: true }> {
    return this.engines.uninstallLlamacpp();
  }

  @Get('components')
  components(@Query('disk') disk?: string): Promise<ComponentInfo[]> {
    return this.engines.components(disk === 'true');
  }

  @Delete('components/:componentId')
  removeComponent(@Param('componentId') componentId: string) {
    return this.engines.removeComponent(componentId);
  }

  @Get('setup/plan/:modelId')
  setupPlan(@Param('modelId') modelId: string): Promise<SetupPlan> {
    return this.engines.setupPlan(modelId);
  }

  @Get('setup')
  setupState(): Promise<SetupState> {
    return this.engines.setupState();
  }

  @Post('setup/:modelId')
  @HttpCode(200)
  startSetup(@Param('modelId') modelId: string): Promise<SetupState> {
    return this.engines.startSetup(modelId);
  }

  @Delete('setup')
  cancelSetup(): Promise<{ ok: true }> {
    return this.engines.cancelSetup();
  }
}
