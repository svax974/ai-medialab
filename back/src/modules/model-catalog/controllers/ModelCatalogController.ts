/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { ModelCatalogService } from '../services/ModelCatalogService';
import { HUB_SEARCH_KINDS, TRENDING_KINDS, type DownloadProgress, type HubInspect, type HubResult, type HubTrending, type ModelCatalog, type TrendingKind } from '../types/modelCatalogTypes';
import { tr } from 'src/modules/i18n';

const asText = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new BadRequestException(tr('modelCatalog.error.string', [name]));
  return value;
};

/** Allowed values of `GET /api/hf/trending`: nothing else reaches the engine. */
const TRENDING_DAYS = { min: 7, max: 365, fallback: 90 };
const TRENDING_LIMIT = { min: 1, max: 30, fallback: 12 };

const asKind = (value: unknown): TrendingKind => {
  if (value === undefined) return 'image';
  if (typeof value === 'string' && (TRENDING_KINDS as readonly string[]).includes(value)) return value as TrendingKind;
  throw new BadRequestException(tr('modelCatalog.error.oneOf', ['kind', TRENDING_KINDS.join(', ')]));
};

const asBoundedInt = (value: unknown, name: string, bounds: { min: number; max: number; fallback: number }): number => {
  if (value === undefined) return bounds.fallback;
  const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) throw new BadRequestException(tr('modelCatalog.error.integer', [name, bounds.min, bounds.max]));
  return n;
};

const asFlag = (value: unknown, name: string): boolean => {
  if (value === undefined) return false;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new BadRequestException(tr('modelCatalog.error.boolean', [name]));
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

  @Delete('models/:id/source/bf16')
  freeBf16Source(@Param('id') id: string): Promise<{ freed_gb: number }> {
    return this.catalog.freeBf16Source(id);
  }

  @Get('hf/search')
  search(@Query('kind') kind = 'image', @Query('q') q = ''): Promise<{ results: HubResult[] }> {
    if (!(HUB_SEARCH_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(tr('modelCatalog.error.oneOf', ['kind', HUB_SEARCH_KINDS.join(', ')]));
    return this.catalog.searchHub(kind, q);
  }

  /** New models of a kind that are successful and runnable on this machine (the engine ranks and keeps them an hour). */
  @Get('hf/trending')
  trending(
    @Query('kind') kind?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('include_heavy') includeHeavy?: string,
    @Query('refresh') refresh?: string,
  ): Promise<HubTrending> {
    return this.catalog.trendingHub({
      kind: asKind(kind),
      days: asBoundedInt(days, 'days', TRENDING_DAYS),
      limit: asBoundedInt(limit, 'limit', TRENDING_LIMIT),
      include_heavy: asFlag(includeHeavy, 'include_heavy'),
      refresh: asFlag(refresh, 'refresh'),
    });
  }

  @Get('hf/inspect')
  inspect(@Query('repo') repo?: string): Promise<HubInspect> {
    return this.catalog.inspectHub(asText(repo, 'repo'));
  }
}
