/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { GenerationQueueService, type QueuePublic } from '../services/GenerationQueueService';

/** `GET /api/queue`: the generation queue as `studio.queue.updated` publishes it (initial state of a browser). Admin only. */
@ApiExcludeController()
@Controller('api/queue')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class QueueController {
  constructor(private readonly queue: GenerationQueueService) {}

  @Get()
  get(): QueuePublic {
    return this.queue.publicQueue();
  }
}
