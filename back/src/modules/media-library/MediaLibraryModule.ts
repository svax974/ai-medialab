/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetEntity } from './entities/AssetEntity';
import { AssetService } from './services/AssetService';

/** Assets (uploads and generated files): persistence only for now, routes arrive with H4.4. See README.md. */
@Module({
  imports: [TypeOrmModule.forFeature([AssetEntity])],
  providers: [AssetService],
  exports: [TypeOrmModule, AssetService],
})
export class MediaLibraryModule {}
