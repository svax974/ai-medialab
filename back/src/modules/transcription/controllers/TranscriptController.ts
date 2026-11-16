/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { rm } from 'fs/promises';
import { decodeUploadName, uploadStorage } from 'src/modules/media-library';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { MAX_UPLOAD_BYTES, optionalField, transcriptFileName, transcriptLanguage } from '../lib/transcriptRules';
import { TranscriptService } from '../services/TranscriptService';
import type { TranscriptDetailDto, TranscriptDto } from '../types/transcriptTypes';

@ApiExcludeController()
@Controller('api/transcripts')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class TranscriptController {
  constructor(private readonly transcripts: TranscriptService) {}

  @Get()
  list(@Query('q') query?: string): Promise<TranscriptDto[]> { return this.transcripts.list(query); }

  @Get(':id')
  detail(@Param('id') id: string): Promise<TranscriptDetailDto> { return this.transcripts.detail(id); }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async create(@Body() body: Record<string, unknown>, @UploadedFile() file?: Express.Multer.File): Promise<TranscriptDto> {
    try {
      return await this.transcripts.create({
        url: optionalField(body?.url), modelId: optionalField(body?.model_id), language: transcriptLanguage(body?.language),
        filePath: file?.path, originalName: file ? decodeUploadName(file.originalname) : undefined,
      });
    } finally { if (file) await rm(file.path, { force: true }); }
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<TranscriptDetailDto> {
    return this.transcripts.edit(id, body?.text);
  }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Param('id') id: string): Promise<TranscriptDto> { return this.transcripts.cancel(id); }

  @Post(':id/retry') @HttpCode(200)
  retry(@Param('id') id: string): Promise<TranscriptDto> { return this.transcripts.retry(id); }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> { await this.transcripts.remove(id); return { ok: true }; }

  @Get(':id/export')
  async export(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const transcript = await this.transcripts.detail(id);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const filename = encodeURIComponent(transcriptFileName(transcript.title)).replace(/['()*!]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    response.send(transcript.text);
  }
}
