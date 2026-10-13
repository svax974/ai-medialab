/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UnprocessableEntityException,
  UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { diskStorage } from 'multer';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { AssetDto } from '../dto/AssetDto';
import { AssetPageDto } from '../dto/AssetListItemDto';
import { AssetFileService } from '../services/AssetFileService';
import { AssetService } from '../services/AssetService';
import { StudioEvents } from '../services/StudioEvents';
import { uploadsDir } from '../utils/dataDir';

/** A video upload is capped at 500 MB, like the legacy route. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 50;

const storage = diskStorage({
  destination: (_req, _file, done) => {
    try {
      const dir = uploadsDir();
      mkdirSync(dir, { recursive: true });
      done(null, dir);
    } catch (error) {
      done(error as Error, '');
    }
  },
  filename: (_req, _file, done) => done(null, `tmp_${randomBytes(8).toString('hex')}`),
});

/** The browser sends names as UTF-8 but multer reads them as latin1. */
const decodeName = (name: string): string => Buffer.from(name, 'latin1').toString('utf8');

/** `/api/assets`: same URLs and shapes as the engine's legacy routes (uploads, gallery, favourite, delete). Admin only. */
@ApiExcludeController()
@Controller('api/assets')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class AssetController {
  constructor(
    private readonly assets: AssetService,
    private readonly files: AssetFileService,
    private readonly events: StudioEvents,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, { storage, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFiles() files: Express.Multer.File[] = []): Promise<AssetDto[]> {
    if (!files.length) throw new UnprocessableEntityException('Aucun fichier reçu (champ « files »).');
    const created: AssetDto[] = [];
    for (const file of files) {
      created.push(await this.files.ingest({ path: file.path, originalName: decodeName(file.originalname), mimeType: file.mimetype }));
    }
    return created;
  }

  @Get()
  list(
    @Query('kind') kind?: string,
    @Query('media') media?: string,
    @Query('favorites') favorites?: string,
    @Query('q') q?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<AssetPageDto> {
    return this.assets.list({
      kind: kind === 'upload' ? 'upload' : 'generated',
      media: media ?? 'image',
      favorites: favorites === 'true' || favorites === '1',
      q: q || undefined,
      before: before && Number.isFinite(Number(before)) && Number(before) > 0 ? Number(before) : undefined,
      limit: limit && Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : undefined,
    });
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: { favorite?: unknown }): Promise<AssetDto> {
    if (body?.favorite != null && typeof body.favorite !== 'boolean') throw new UnprocessableEntityException('favorite : booléen attendu.');
    const asset = body?.favorite == null ? await this.assets.get(id) : await this.assets.setFavorite(id, body.favorite as boolean);
    if (!asset) throw new NotFoundException('Image introuvable.');
    this.events.publish('asset.updated', asset);
    return asset;
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    const asset = await this.assets.remove(id);
    if (!asset) throw new NotFoundException('Image introuvable.');
    await this.files.removeFiles([asset]);
    this.events.publish('asset.deleted', { id, message_id: asset.messageId, conversation_id: asset.conversationId });
    return { ok: true };
  }
}
