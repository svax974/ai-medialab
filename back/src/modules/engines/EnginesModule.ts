/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { EnginesController } from './controllers/EnginesController';
import { EnginesService } from './services/EnginesService';

/** Installers of the inference engines: audio/video packs and stable-diffusion.cpp (`/api/engines/*`). See README.md. */
@Module({
  imports: [CommonModule],
  controllers: [EnginesController],
  providers: [EnginesService],
  exports: [EnginesService],
})
export class EnginesModule {}
