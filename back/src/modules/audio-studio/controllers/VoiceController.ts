/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, UnprocessableEntityException,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { decodeUploadName, uploadStorage } from 'src/modules/media-library';
import { VoiceDto } from '../dto/VoiceDto';
import { VoiceTranscriptionDto } from '../dto/VoiceTranscriptionDto';
import { VoiceFileService } from '../services/VoiceFileService';
import { VoiceService } from '../services/VoiceService';
import { parseTranscribeVoice, parseUpdateVoice, parseUploadVoice, parseVoiceFromAsset } from '../services/voiceParams';

/** A voice sample is a short clip: 100 MB is far more than a 30 s recording of any format. */
const MAX_VOICE_UPLOAD_BYTES = 100 * 1024 * 1024;

/** `/api/voices`: same URLs and shapes as the engine's legacy routes (library, upload, from a take, edit, delete, transcribe). Admin only. */
@ApiExcludeController()
@Controller('api/voices')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class VoiceController {
  constructor(
    private readonly voices: VoiceService,
    private readonly files: VoiceFileService,
  ) {}

  @Get()
  list(): Promise<VoiceDto[]> {
    return this.voices.list();
  }

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_VOICE_UPLOAD_BYTES } }))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown): Promise<VoiceDto> {
    if (!file) throw new UnprocessableEntityException(tr('audioStudio.error.noFileReceived'));
    const input = parseUploadVoice(body);
    return this.files.createFromUpload({ path: file.path, originalName: decodeUploadName(file.originalname), mimeType: file.mimetype }, input);
  }

  @Post('from-asset')
  @HttpCode(200)
  fromAsset(@Body() body: unknown): Promise<VoiceDto> {
    return this.files.createFromAsset(parseVoiceFromAsset(body));
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<VoiceDto> {
    const voice = await this.files.update(id, parseUpdateVoice(body));
    if (!voice) throw new NotFoundException(tr('audioStudio.error.voiceNotFound'));
    return voice;
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.files.remove(id))) throw new NotFoundException(tr('audioStudio.error.voiceNotFound'));
    return { ok: true };
  }

  @Post(':id/transcribe')
  @HttpCode(200)
  transcribe(@Param('id') id: string, @Body() body: unknown): Promise<VoiceTranscriptionDto> {
    return this.files.transcribe(id, parseTranscribeVoice(body));
  }
}
