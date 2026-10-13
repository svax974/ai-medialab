/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { MediaLibraryModule } from 'src/modules/media-library';
import { VoiceController } from './controllers/VoiceController';
import { VoiceEntity } from './entities/VoiceEntity';
import { VoiceFileService } from './services/VoiceFileService';
import { VoiceService } from './services/VoiceService';

/** The voice library: persistence, `/api/voices*` and the sample files (prepared and transcribed by the engine). See README.md. */
@Module({
  imports: [CommonModule, MediaLibraryModule, TypeOrmModule.forFeature([VoiceEntity])],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceFileService],
  exports: [TypeOrmModule, VoiceService, VoiceFileService],
})
export class AudioStudioModule {}
