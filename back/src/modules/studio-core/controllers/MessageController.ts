/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Body, Controller, Delete, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { MessageDto } from '../dto/MessageDto';
import { CreatedGeneration, GenerationService } from '../services/GenerationService';
import { parseCreateMessage, parseRetry } from '../services/generationParams';

/** `/api/messages*`: same URLs and shapes as the engine's legacy routes. Admin only. */
@ApiExcludeController()
@Controller('api/messages')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class MessageController {
  constructor(private readonly generations: GenerationService) {}

  @Post()
  @HttpCode(200)
  create(@Body() body: unknown): Promise<CreatedGeneration> {
    return this.generations.create(parseCreateMessage(body));
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string, @Body() body: unknown): Promise<MessageDto> {
    return this.generations.retry(id, parseRetry(body));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): Promise<{ ok: true }> {
    return this.generations.cancel(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ ok: true; deleted: string[] }> {
    return this.generations.remove(id);
  }
}
