/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryModule } from 'src/modules/media-library';
import { ModelCatalogModule } from 'src/modules/model-catalog';
import { StudioCoreModule } from 'src/modules/studio-core';
import { PrivateModule } from 'src/modules/private';
import { TranscriptController } from './controllers/TranscriptController';
import { TranscriptEntity } from './entities/TranscriptEntity';
import { TranscriptEngineClient } from './services/TranscriptEngineClient';
import { TranscriptQueue } from './services/TranscriptQueue';
import { TranscriptService } from './services/TranscriptService';
import { TranscriptStore } from './services/TranscriptStore';

@Module({
  imports: [MediaLibraryModule, StudioCoreModule, ModelCatalogModule, PrivateModule, TypeOrmModule.forFeature([TranscriptEntity])],
  controllers: [TranscriptController], providers: [TranscriptEngineClient, TranscriptStore, TranscriptQueue, TranscriptService],
})
export class TranscriptionModule {}
