/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { parseAdviseBody } from '../dto/AdviseBody';
import { parseUpdateEngineBody } from '../dto/UpdateEngineBody';
import { UpdatesService } from '../services/UpdatesService';
import type { UpdateAdvisory, UpdateStarted, UpdatesReport } from '../types/updatesTypes';

/** `/api/updates/*`: check, ask for the risks of an update, then update one engine or one model at a time. Admin only. */
@ApiExcludeController()
@Controller('api/updates')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get('check')
  check(): Promise<UpdatesReport> {
    return this.updates.check();
  }

  @Get('advisories')
  advisories(): Promise<UpdateAdvisory[]> {
    return this.updates.listAdvisories();
  }

  @Post('advise')
  @HttpCode(200)
  advise(@Body() body: unknown): Promise<UpdateAdvisory> {
    return this.updates.advise(parseAdviseBody(body));
  }

  @Delete('advisories/:id')
  async removeAdvisory(@Param('id') id: string): Promise<{ ok: true }> {
    await this.updates.removeAdvisory(id);
    return { ok: true };
  }

  @Post('models/:id')
  @HttpCode(200)
  updateModel(@Param('id') id: string): Promise<UpdateStarted> {
    return this.updates.updateModel(id);
  }

  @Post('engines/:id')
  @HttpCode(200)
  updateEngine(@Param('id') id: string, @Body() body?: { target?: unknown }): Promise<UpdateStarted> {
    return this.updates.updateEngine(id, parseUpdateEngineBody(body));
  }
}
