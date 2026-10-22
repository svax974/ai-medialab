/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { AssetController } from './controllers/AssetController';
import { AssetEntity } from './entities/AssetEntity';
import { AssetFileService } from './services/AssetFileService';
import { AssetService } from './services/AssetService';
import { StudioEventLimitsModule } from './StudioEventLimitsModule';
import { StudioEvents } from './services/StudioEvents';

/** Assets (uploads and generated files): persistence, `/api/assets` and the studio event publisher. See README.md. */
@Module({
  imports: [CommonModule, StudioEventLimitsModule, TypeOrmModule.forFeature([AssetEntity])],
  controllers: [AssetController],
  providers: [AssetService, AssetFileService, StudioEvents],
  exports: [TypeOrmModule, AssetService, AssetFileService, StudioEvents],
})
export class MediaLibraryModule {}
