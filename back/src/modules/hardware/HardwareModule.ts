/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { HardwareController } from './controllers/HardwareController';
import { HardwareService } from './services/HardwareService';

/** Machine description and engine state (`/api/system`, `/api/status`, `/api/engine/unload`). See README.md. */
@Module({
  imports: [CommonModule],
  controllers: [HardwareController],
  providers: [HardwareService],
  exports: [HardwareService],
})
export class HardwareModule {}
