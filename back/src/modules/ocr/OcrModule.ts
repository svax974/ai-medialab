/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryModule } from 'src/modules/media-library';
import { ModelCatalogModule } from 'src/modules/model-catalog';
import { StudioCoreModule } from 'src/modules/studio-core';
import { OcrController } from './controllers/OcrController';
import { OcrDocumentEntity } from './entities/OcrDocumentEntity';
import { OcrPageEntity } from './entities/OcrPageEntity';
import { EngineOcrClient } from './services/EngineOcrClient';
import { OcrQueueService } from './services/OcrQueueService';
import { OcrService } from './services/OcrService';
import { OcrStoreService } from './services/OcrStoreService';

/** The OCR tab: readings of images and PDFs by a local OCR model (`/api/ocr/*`). See README.md. */
@Module({
  imports: [MediaLibraryModule, StudioCoreModule, ModelCatalogModule, TypeOrmModule.forFeature([OcrDocumentEntity, OcrPageEntity])],
  controllers: [OcrController],
  providers: [EngineOcrClient, OcrStoreService, OcrQueueService, OcrService],
  exports: [OcrService],
})
export class OcrModule {}
