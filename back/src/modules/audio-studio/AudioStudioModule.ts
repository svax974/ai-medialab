/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceEntity } from './entities/VoiceEntity';
import { VoiceService } from './services/VoiceService';

/** The voice library: persistence only for now, routes and the audio composer arrive with H4.5. See README.md. */
@Module({
  imports: [TypeOrmModule.forFeature([VoiceEntity])],
  providers: [VoiceService],
  exports: [TypeOrmModule, VoiceService],
})
export class AudioStudioModule {}
