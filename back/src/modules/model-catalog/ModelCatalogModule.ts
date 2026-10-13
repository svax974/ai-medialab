/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { ModelCatalogController } from './controllers/ModelCatalogController';
import { ModelCatalogService } from './services/ModelCatalogService';

/** Model catalogue, downloads, custom models and Hugging Face search (`/api/models*`, `/api/hf/*`). See README.md. */
@Module({
  imports: [CommonModule],
  controllers: [ModelCatalogController],
  providers: [ModelCatalogService],
  exports: [ModelCatalogService],
})
export class ModelCatalogModule {}
