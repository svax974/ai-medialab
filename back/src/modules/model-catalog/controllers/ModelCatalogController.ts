/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { ModelCatalogService } from '../services/ModelCatalogService';
import type { DownloadProgress, HubInspect, HubResult, ModelCatalog } from '../types/modelCatalogTypes';

const asText = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  return value;
};

/** `/api/models*` and `/api/hf/*`: same URLs and shapes as the engine's legacy routes. Admin only. */
@ApiExcludeController()
@Controller('api')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class ModelCatalogController {
  constructor(private readonly catalog: ModelCatalogService) {}

  @Get('models')
  list(): Promise<ModelCatalog> {
    return this.catalog.catalog();
  }

  /** Declared before `models/:id/...` so that `custom` is never read as a model id. */
  @Post('models/custom')
  @HttpCode(200)
  addCustom(@Body() body: { repo?: unknown; option?: unknown }): Promise<{ model_id: string }> {
    const option = body?.option === undefined ? 'default' : asText(body.option, 'option');
    return this.catalog.addCustom(asText(body?.repo, 'repo').trim(), option);
  }

  @Post('models/:id/download')
  @HttpCode(200)
  download(@Param('id') id: string): Promise<DownloadProgress> {
    return this.catalog.startDownload(id);
  }

  @Delete('models/:id/download')
  cancelDownload(@Param('id') id: string): Promise<{ ok: true }> {
    return this.catalog.cancelDownload(id);
  }

  @Delete('models/:id/custom')
  removeCustom(@Param('id') id: string): Promise<{ freed_gb: number }> {
    return this.catalog.removeCustom(id);
  }

  @Delete('models/:id')
  remove(@Param('id') id: string): Promise<{ freed_gb: number; also_affects: string[] }> {
    return this.catalog.deleteModel(id);
  }

  @Get('hf/search')
  search(@Query('kind') kind = 'image', @Query('q') q = ''): Promise<{ results: HubResult[] }> {
    return this.catalog.searchHub(kind, q);
  }

  @Get('hf/inspect')
  inspect(@Query('repo') repo?: string): Promise<HubInspect> {
    return this.catalog.inspectHub(asText(repo, 'repo'));
  }
}
