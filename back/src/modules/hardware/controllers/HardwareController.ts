/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Controller, Get, HttpCode, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { HardwareService } from '../services/HardwareService';
import type { EmergencyStopResult, EngineStatus, MemoryLive, SystemInfo } from '../types/hardwareTypes';

/** `/api/system`, `/api/memory`, `/api/status`, `/api/engine/unload`, `/api/engine/emergency-stop`: same URLs as the engine's legacy routes. Admin only. */
@ApiExcludeController()
@Controller('api')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class HardwareController {
  constructor(private readonly hardware: HardwareService) {}

  @Get('system')
  system(@Query('refresh') refresh?: string): Promise<SystemInfo> {
    return this.hardware.system(refresh === 'true' || refresh === '1');
  }

  @Get('memory')
  memory(): Promise<MemoryLive> {
    return this.hardware.memory();
  }

  @Post('engine/emergency-stop')
  @HttpCode(200)
  emergencyStop(): Promise<EmergencyStopResult> {
    return this.hardware.emergencyStop();
  }

  @Get('status')
  status(): Promise<EngineStatus> {
    return this.hardware.status();
  }

  @Post('engine/unload')
  @HttpCode(200)
  unload(): Promise<EngineStatus> {
    return this.hardware.unload();
  }
}
