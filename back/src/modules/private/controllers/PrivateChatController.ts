/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Body, Controller, Delete, HttpCode, Param, Post, Res, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MAX_IMAGE_BYTES, SseStream, parseEnhanceBody, type ChatAttachment } from 'src/modules/chat';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { PrivateChatAttachmentService } from '../services/PrivateChatAttachmentService';
import { PrivateChatService } from '../services/PrivateChatService';
import { parsePrivateChatBody } from '../services/privateChatValidation';
import { NoStoreInterceptor } from './NoStoreInterceptor';
import { privateUploadStorage } from './privateUpload';

/**
 * `/api/private/chat/*`: the chat of the private session, without a state (the browser keeps the conversation and sends the
 * whole history with each request). Same events as the normal chat for the stream, `no-store` on everything. Admin only.
 */
@ApiExcludeController()
@Controller('api/private/chat')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor, NoStoreInterceptor)
export class PrivateChatController {
  constructor(
    private readonly chat: PrivateChatService,
    private readonly attachments: PrivateChatAttachmentService,
  ) {}

  /** One reply (server-sent events). The headers go out with the first event: a refusal before it is an ordinary HTTP error. */
  @Post()
  async reply(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = parsePrivateChatBody(body);
    const sink = new SseStream(res, 'no-store, no-transform');
    try {
      await this.chat.reply(parsed, sink);
    } catch (error) {
      if (!sink.started) throw error;
      sink.emit('error', { code: 'upstream', message: tr('private.chat.unexpectedFailure') });
    } finally {
      sink.end();
    }
  }

  @Post('enhance-prompt')
  @HttpCode(200)
  enhance(@Body() body: unknown): Promise<{ prompt: string; model_id: string }> {
    const { kind, prompt, modelId } = parseEnhanceBody(body);
    return this.chat.enhance(kind, prompt, modelId);
  }

  @Post('attachments')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: privateUploadStorage, limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  upload(@UploadedFile() file?: Express.Multer.File): Promise<ChatAttachment> {
    if (!file) throw new UnprocessableEntityException(tr('private.error.noFileReceived'));
    return this.attachments.accept(file);
  }

  @Delete('attachments/:name')
  async removeAttachment(@Param('name') name: string): Promise<{ ok: true }> {
    await this.attachments.remove(name);
    return { ok: true };
  }
}
