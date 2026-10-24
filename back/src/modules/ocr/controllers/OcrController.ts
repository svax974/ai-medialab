/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UnprocessableEntityException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { rm } from 'fs/promises';
import { tr } from 'src/modules/i18n';
import { AssetService, assetFilePath, decodeUploadName, uploadStorage } from 'src/modules/media-library';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { parsePageSpec } from '../lib/pageSpec';
import { OcrService, type RetryOverrides } from '../services/OcrService';
import { OCR_EXPORT_FORMATS, OCR_TASKS, type CreateOcrInput, type OcrDocumentDetailDto, type OcrDocumentDto, type OcrExportFormat, type OcrTask } from '../types/ocrTypes';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

type Body = Record<string, unknown>;

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  return value;
}

function optionalTask(value: unknown): OcrTask | undefined {
  const task = optionalText(value, 'task');
  if (task === undefined) return undefined;
  if (!(OCR_TASKS as readonly string[]).includes(task)) throw new BadRequestException(`"task" must be one of: ${OCR_TASKS.join(', ')}`);
  return task as OcrTask;
}

/** `pages` arrives as text ("1-3, 5") from a form; null when empty (all pages). */
function optionalPages(value: unknown): number[] | null | undefined {
  if (value === undefined) return undefined;
  const pages = Array.isArray(value) ? value.map(Number) : parsePageSpec(typeof value === 'string' ? value : String(value));
  if (pages === undefined || (Array.isArray(pages) && pages.some((p) => !Number.isInteger(p) || p < 1))) {
    throw new UnprocessableEntityException(tr('ocr.error.pages'));
  }
  return pages;
}

function overridesOf(body: Body): RetryOverrides {
  const pages = optionalPages(body.pages);
  return {
    modelId: optionalText(body.model_id, 'model_id'),
    task: optionalTask(body.task),
    prompt: body.prompt === undefined ? undefined : (optionalText(body.prompt, 'prompt') ?? ''),
    ...(pages === undefined ? {} : { pages }),
    ...(body.force_memory === true ? { forceMemory: true } : {}),
  };
}

/** `/api/ocr/*`: the OCR tab (readings of images and PDFs by an OCR model). Admin only. See README.md. */
@ApiExcludeController()
@Controller('api/ocr')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class OcrController {
  constructor(
    private readonly ocr: OcrService,
    private readonly assets: AssetService,
  ) {}

  @Get('documents')
  list(@Query('q') q?: string): Promise<OcrDocumentDto[]> {
    return this.ocr.list(q);
  }

  /** Multipart `file` (image or PDF), or JSON/form `asset_id` (an image of the library); plus `model_id`, `task`, `prompt`, `pages`. */
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async create(@Body() body: Body, @UploadedFile() file?: Express.Multer.File): Promise<OcrDocumentDto> {
    const common = {
      modelId: optionalText(body.model_id, 'model_id'),
      task: optionalTask(body.task),
      prompt: optionalText(body.prompt, 'prompt'),
      pages: optionalPages(body.pages) ?? undefined,
    };
    const assetId = optionalText(body.asset_id, 'asset_id');
    if (file) {
      const input: CreateOcrInput = { ...common, filePath: file.path, originalName: decodeUploadName(file.originalname) };
      try {
        return await this.ocr.create(input, true);
      } catch (error) {
        await rm(file.path, { force: true });
        throw error;
      }
    }
    if (!assetId) throw new UnprocessableEntityException(tr('ocr.error.noFile'));
    const asset = await this.assets.getEntity(assetId);
    if (!asset || asset.media !== 'image') throw new UnprocessableEntityException(tr('ocr.error.assetNotImage'));
    return this.ocr.create({ ...common, filePath: assetFilePath(asset.kind, asset.filename), originalName: asset.originalName || asset.filename }, false);
  }

  @Get('documents/:id')
  detail(@Param('id') id: string): Promise<OcrDocumentDetailDto> {
    return this.ocr.detail(id);
  }

  @Post('documents/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): Promise<OcrDocumentDto> {
    return this.ocr.cancel(id);
  }

  @Post('documents/:id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string, @Body() body: Body): Promise<OcrDocumentDto> {
    return this.ocr.retry(id, overridesOf(body ?? {}));
  }

  @Delete('documents/:id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.ocr.remove(id);
    return { ok: true };
  }

  @Get('documents/:id/export')
  async export(@Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const chosen = (format ?? 'txt') as OcrExportFormat;
    if (!OCR_EXPORT_FORMATS.includes(chosen)) throw new BadRequestException(`"format" must be one of: ${OCR_EXPORT_FORMATS.join(', ')}`);
    const { body, mime, fileName } = await this.ocr.exportFile(id, chosen);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(body);
  }

  @Get('documents/:id/source')
  async source(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { path } = await this.ocr.sourcePath(id);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path);
  }
}
