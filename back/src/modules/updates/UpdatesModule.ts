/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { StudioCoreModule } from 'src/modules/studio-core';
import { UpdatesController } from './controllers/UpdatesController';
import { UpdateAdvisoryEntity } from './entities/UpdateAdvisoryEntity';
import { UpdateAdvisoryService } from './services/UpdateAdvisoryService';
import { UpdatesService } from './services/UpdatesService';

/** Update checks of the installed engines and models, and the advice about them (`/api/updates/*`). See README.md. */
@Module({
  imports: [CommonModule, StudioCoreModule, TypeOrmModule.forFeature([UpdateAdvisoryEntity])],
  controllers: [UpdatesController],
  providers: [UpdatesService, UpdateAdvisoryService],
  exports: [UpdatesService, UpdateAdvisoryService, TypeOrmModule],
})
export class UpdatesModule {}
