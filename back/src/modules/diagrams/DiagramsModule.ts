/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { ChatModule } from 'src/modules/chat';
import { MediaLibraryModule } from 'src/modules/media-library';
import { StudioCoreModule } from 'src/modules/studio-core';
import { DiagramsController } from './controllers/DiagramsController';
import { DiagramsService } from './services/DiagramsService';

/** The Diagrams tab: organization charts, flowcharts, schemas (`/api/diagrams/*`). See README.md. */
@Module({
  imports: [ChatModule, MediaLibraryModule, StudioCoreModule],
  controllers: [DiagramsController],
  providers: [DiagramsService],
})
export class DiagramsModule {}
