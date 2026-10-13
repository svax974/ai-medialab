/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { AudioStudioModule } from 'src/modules/audio-studio';
import { MediaLibraryModule } from 'src/modules/media-library';
import { SettingsModule } from 'src/modules/settings';
import { StudioCoreModule } from 'src/modules/studio-core';
import { ImportMarkerEntity } from './entities/ImportMarkerEntity';
import { LegacyImportBootstrap } from './services/LegacyImportBootstrap';
import { LegacyImportService } from './services/LegacyImportService';

/** Imports the legacy engine database at the first start. Removed with the engine's own persistence (H6). See README.md. */
@Module({
  imports: [
    CommonModule,
    SettingsModule,
    StudioCoreModule,
    MediaLibraryModule,
    AudioStudioModule,
    TypeOrmModule.forFeature([ImportMarkerEntity]),
  ],
  providers: [LegacyImportService, LegacyImportBootstrap],
  exports: [LegacyImportService],
})
export class LegacyImportModule {}
